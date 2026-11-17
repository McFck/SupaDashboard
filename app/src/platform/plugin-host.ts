// The native plugin host (installs `.sdplugin` files, lists what is installed) and the routing of plugin service
// calls: a plugin's service runs in the dashboard owner (`main`), the panel reaches it through events.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { emit, emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** A plugin service: its methods by name, each taking the call's params. */
export type PluginService = Record<string, (params: unknown) => unknown>;

const services = new Map<string, PluginService>();
let serving: Promise<unknown> | undefined;
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let replies: Promise<unknown> | undefined;
/** The longest call: a sign-in waits up to 5 minutes for the browser. */
const CALL_TIMEOUT = 360_000;
const REPLY_ID = /^[0-9a-f-]{36}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function serviceMethod(plugin: unknown, name: unknown) {
  const service = typeof plugin === 'string' ? services.get(plugin) : undefined;
  if (!service) {
    throw new Error(`${String(plugin)} is not running`);
  }
  const run = typeof name === 'string' && Object.hasOwn(service, name) ? service[name] : undefined;
  if (typeof run !== 'function') {
    throw new Error(`${String(plugin)} has no method ${String(name)}`);
  }
  return (params: unknown) => run.call(service, params);
}

/** Answers a panel's `plugin-call` envelope `{plugin, method, params, reply}`; one without a reply id is dropped. */
async function answer(raw: unknown) {
  if (!isObject(raw) || typeof raw.reply !== 'string' || !REPLY_ID.test(raw.reply)) {
    return;
  }
  const { reply } = raw;
  try {
    const value = await serviceMethod(raw.plugin, raw.method)(raw.params ?? null);
    await emit('plugin-reply', { reply, ok: true, value });
  } catch (error) {
    await emit('plugin-reply', {
      reply,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function settle(raw: unknown) {
  const call = isObject(raw) && typeof raw.reply === 'string' ? pending.get(raw.reply) : undefined;
  if (!isObject(raw) || !call) {
    return;
  }
  if (raw.ok === true) {
    call.resolve(raw.value);
  } else {
    call.reject(new Error(typeof raw.error === 'string' ? raw.error : 'Plugin call failed'));
  }
}

/** Serves a plugin's service in this window (the dashboard owner) and announces it with `plugin://<id>/ready`. */
export function providePlugin(id: string, service: PluginService): () => void {
  services.set(id, service);
  serving ??= listen<unknown>('plugin-call', (event) => void answer(event.payload));
  void serving.then(() => emitPluginEvent(id, 'ready', null));
  return () => {
    if (services.get(id) === service) {
      services.delete(id);
    }
  };
}

/** Sends `plugin://<plugin>/<event>` to every window. */
export const emitPluginEvent = (plugin: string, event: string, data: unknown) =>
  emit(`plugin://${plugin}/${event}`, data);

/** Calls a plugin service: directly where it runs, from the panel through the dashboard owner. */
export async function callPlugin(
  plugin: string,
  method: string,
  params: unknown = null,
): Promise<unknown> {
  if (services.has(plugin) || getCurrentWindow().label === 'main') {
    return await serviceMethod(plugin, method)(params);
  }
  replies ??= listen<unknown>('plugin-reply', (event) => settle(event.payload));
  await replies;
  const reply = crypto.randomUUID();
  const settled = new Promise<unknown>((resolve, reject) =>
    pending.set(reply, { resolve, reject }),
  );
  const timer = setTimeout(
    () => settle({ reply, ok: false, error: `${plugin} did not answer` }),
    CALL_TIMEOUT,
  );
  try {
    // Together, so a reply that arrives before `emitTo` returns is never an unhandled rejection.
    const [, value] = await Promise.all([
      emitTo('main', 'plugin-call', { plugin, method, params, reply }),
      settled,
    ]);
    return value;
  } finally {
    clearTimeout(timer);
    pending.delete(reply);
  }
}

/** Raw `plugin_list`; `features/plugins/external/load.ts` validates it. */
export const listPlugins = () => invoke<unknown>('plugin_list');

/** Raw signed catalogue entries; `features/plugins/plugin-store.ts` validates them. Throws a short message. */
export const pluginCatalogue = () => invoke<unknown>('plugin_catalogue');

/** Installs or updates a verified release from the catalogue. */
export const installPlugin = (id: string) => invoke<void>('plugin_install', { id });

/** Raw `{id, version, trust, permissions, sha256}` of a `.sdplugin`; `features/plugins/file-install.ts` validates it. */
export const inspectPluginFile = (path: string) => invoke<unknown>('plugin_inspect_file', { path });

/** Installs the copy `inspectPluginFile` staged as `sha256`; returns the installed id. */
export const installPluginFile = (sha256: string) =>
  invoke<string>('plugin_install_file', { sha256 });

/** A `.sdplugin` opened from Explorer that waits for the panel, once. */
export const takeOpenedPluginFile = () => invoke<string | null>('plugin_opened_file');

/** Deletes an installed plugin's file; its data and settings stay. */
export const uninstallPlugin = (id: string) => invoke<void>('plugin_uninstall', { id });

/** `ready` means the plugin's service (re)started in the owner without its subscribers or state. */
export const onPluginEvent = <T>(plugin: string, event: string, handler: (payload: T) => void) =>
  listen<T>(`plugin://${plugin}/${event}`, (message) => handler(message.payload));

/**
 * One service `subscribe` shared by every listener of a plugin's `state` events. `read` validates each
 * payload; `idle` is the view without a subscription and `failed` the view while a failed start retries.
 */
export function pluginStateHub<V>(plugin: string, read: (raw: unknown) => V, idle: V, failed: V) {
  const listeners = new Set<(view: V) => void>();
  let latest = idle;
  /** Bumped on every start and stop, so a late event or a finished native call is dropped. */
  let epoch = 0;
  let unlisten: (() => void) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  /** Native calls run in order; each reports its own failure, so a failed start never blocks cleanup. */
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (job: () => Promise<void>) => (queue = queue.catch(() => {}).then(job));

  function deliver(view: V) {
    latest = view;
    for (const listener of [...listeners]) {
      listener(latest);
    }
  }

  function start() {
    clearTimeout(retry);
    const mine = ++epoch;
    enqueue(async () => {
      if (mine !== epoch) {
        return;
      }
      unlisten?.();
      let receivedEvent = false;
      const stops = [
        await onPluginEvent<unknown>(plugin, 'state', (payload) => {
          if (mine === epoch) {
            receivedEvent = true;
            deliver(read(payload));
          }
        }),
        // A service that (re)started in the owner has no subscribers; subscribe again.
        await onPluginEvent(plugin, 'ready', () => {
          if (mine === epoch) {
            start();
          }
        }),
      ];
      unlisten = () => stops.forEach((stop) => stop());
      const snapshot = await callPlugin(plugin, 'subscribe');
      // Events can arrive while invoke is returning an older snapshot.
      if (mine === epoch && !receivedEvent) {
        deliver(read(snapshot));
      }
    }).catch(() => {
      if (mine === epoch) {
        deliver(failed);
        retry = setTimeout(start, 5000);
      }
    });
  }

  return {
    subscribe(listener: (view: V) => void): () => void {
      if (!isTauri()) {
        listener(idle);
        return () => {};
      }
      // A wrapper per call, so one function subscribed twice needs two unsubscribes.
      const receive = (view: V) => listener(view);
      listeners.add(receive);
      receive(latest);
      if (listeners.size === 1) {
        start();
      }
      return () => {
        if (!listeners.delete(receive) || listeners.size) {
          return;
        }
        epoch++;
        clearTimeout(retry);
        latest = idle;
        enqueue(async () => {
          unlisten?.();
          unlisten = undefined;
          await callPlugin(plugin, 'unsubscribe');
        }).catch(() => {
          // The owner is gone or reloading; its service starts again without subscribers.
        });
      };
    },
    /** Waits for queued native calls (rethrowing a failed one), then reports the state they left. */
    async settled() {
      await queue;
      return { latest, subscribed: listeners.size > 0 };
    },
  };
}

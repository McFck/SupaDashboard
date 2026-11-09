// The native plugin host: installs `.sdplugin` files and lists what is installed.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// The native `plugin_call` is gone with plugin processes; calls fail until they route to plugin services.
export const callPlugin = <T>(plugin: string, method: string, params: unknown = null) =>
  invoke<T>('plugin_call', { plugin, method, params });

/** Raw `plugin_list`; `features/plugins/external/load.ts` validates it. */
export const listPlugins = () => invoke<unknown>('plugin_list');

/** Raw signed catalogue entries; `features/plugins/plugin-store.ts` validates them. Throws a short message. */
export const pluginCatalogue = () => invoke<unknown>('plugin_catalogue');

/** Installs or updates a verified release from the catalogue. */
export const installPlugin = (id: string) => invoke<void>('plugin_install', { id });

/** Raw `{id, version, trust, permissions, sha256}` of a `.sdplugin`; `features/plugins/file-install.ts` validates it. */
export const inspectPluginFile = (path: string) => invoke<unknown>('plugin_inspect_file', { path });

/** Installs the inspected file if its bytes still hash to `sha256`; returns the installed id. */
export const installPluginFile = (path: string, sha256: string) =>
  invoke<string>('plugin_install_file', { path, sha256 });

/** A `.sdplugin` opened from Explorer that waits for the panel, once. */
export const takeOpenedPluginFile = () => invoke<string | null>('plugin_opened_file');

/** Deletes an installed plugin's file; its data and settings stay. */
export const uninstallPlugin = (id: string) => invoke<void>('plugin_uninstall', { id });

/** `restarted` means a crashed process came back without its state; the plugin applies it again. */
export const onPluginEvent = <T>(plugin: string, event: string, handler: (payload: T) => void) =>
  listen<T>(`plugin://${plugin}/${event}`, (message) => handler(message.payload));

/**
 * One native `subscribe` shared by every listener of a plugin's `state` events. `read` validates each
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
        // A restarted plugin process has no subscribers; subscribe again.
        await onPluginEvent(plugin, 'restarted', () => {
          if (mine === epoch) {
            start();
          }
        }),
      ];
      unlisten = () => stops.forEach((stop) => stop());
      const snapshot = await callPlugin<unknown>(plugin, 'subscribe');
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
          // Native also releases the subscriber when its window closes.
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

import { emit, emitTo, listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';

export type RuntimeRequest = { type: 'snapshot' | 'simulate' | 'emitEvent' | 'setVariable' | 'createVariable' | 'renameVariable'
  | 'setVariablePersistence' | 'deleteVariable' | 'stop'; payload?: unknown };
export type SyncMessage =
  | { kind: 'request'; sourceId: string; requestId: string; revision: number; request: RuntimeRequest }
  | { kind: 'reply'; sourceId: string; destination: string; requestId: string; revision: number; ok: boolean; value?: unknown; error?: string }
  | { kind: 'snapshot'; sourceId: string; destination?: string; revision: number; value: unknown };
export type SyncAdapter = { send(message: SyncMessage): void; close(): void };
export type SyncOptions = { owner?: boolean; onRequest?: (request: RuntimeRequest, sourceId: string) => unknown | Promise<unknown>;
  onSnapshot?: (snapshot: unknown, revision: number) => void; onAvailability?: (online: boolean) => void };

const CHANNEL = 'supadashboard:runtime:v1';
const MAX_MESSAGE_SIZE = 256 * 1024;
const REQUEST_TYPES = new Set(['snapshot', 'simulate', 'emitEvent', 'setVariable', 'createVariable', 'renameVariable',
  'setVariablePersistence', 'deleteVariable', 'stop']);
const newId = () => globalThis.crypto?.randomUUID?.() ?? `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function validMessage(value: unknown): value is SyncMessage {
  if (!value || typeof value !== 'object') return false;
  let size: number;
  try { size = JSON.stringify(value).length; } catch { return false; }
  if (size > MAX_MESSAGE_SIZE) return false;
  const message = value as Record<string, any>;
  if (typeof message.sourceId !== 'string' || message.sourceId.length > 128 || !Number.isSafeInteger(message.revision) || message.revision < 0) return false;
  if (message.kind === 'request') return typeof message.requestId === 'string' && message.requestId.length <= 128 &&
    message.request && REQUEST_TYPES.has(message.request.type);
  if (message.kind === 'reply') return typeof message.destination === 'string' && typeof message.requestId === 'string' &&
    message.requestId.length <= 128 && typeof message.ok === 'boolean' && (message.error === undefined || typeof message.error === 'string');
  if (message.kind === 'snapshot') return message.destination === undefined || typeof message.destination === 'string';
  return false;
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

/** Request/reply protocol shared by Tauri webviews and browser BroadcastChannel tabs. */
export class RuntimeSync {
  private pending = new Map<string, Pending>();
  private dedupe = new Map<string, SyncMessage>();
  private inFlight = new Map<string, Promise<SyncMessage>>();
  private revision = 0;
  private closed = false;
  constructor(readonly sourceId: string, private adapter: SyncAdapter,
    private options: SyncOptions = {}) {}

  request(request: RuntimeRequest, timeoutMs = 2000) {
    if (this.closed) return Promise.reject(new Error('Runtime connection is closed'));
    if (!REQUEST_TYPES.has(request.type) || !validMessage({ kind: 'request', sourceId: this.sourceId,
      requestId: 'check', revision: this.revision, request })) return Promise.reject(new Error('Invalid runtime request'));
    const requestId = newId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Runtime owner is unavailable')); }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.adapter.send({ kind: 'request', sourceId: this.sourceId, requestId, revision: this.revision, request: structuredClone(request) });
    });
  }

  publish(value: unknown, destination?: string) {
    if (!this.options.owner || this.closed) return;
    this.revision++;
    this.adapter.send({ kind: 'snapshot', sourceId: this.sourceId, ...(destination ? { destination } : {}),
      revision: this.revision, value: structuredClone(value) });
  }

  get currentRevision() { return this.revision; }
  receiveMessage(message: unknown) { this.receive(message); }
  becomeOwner(onRequest: NonNullable<SyncOptions['onRequest']>) {
    this.options.owner = true;
    this.options.onRequest = onRequest;
  }
  releaseOwnership() {
    this.options.owner = false;
    this.options.onRequest = undefined;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.adapter.close();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Runtime connection closed')); }
    this.pending.clear();
    this.dedupe.clear();
    this.inFlight.clear();
    this.options.onAvailability?.(false);
  }

  private receive(value: unknown) {
    if (this.closed || !validMessage(value)) return;
    const message = value;
    if (message.sourceId === this.sourceId || 'destination' in message && message.destination && message.destination !== this.sourceId) return;
    if (message.kind === 'request') { if (this.options.owner) void this.handleRequest(message); return; }
    if (message.kind === 'reply') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.revision < this.revision) pending.reject(new Error('Stale runtime reply'));
      else {
        this.revision = message.revision;
        if (message.ok) { this.options.onAvailability?.(true); pending.resolve(message.value); }
        else pending.reject(new Error(message.error || 'Runtime request failed'));
      }
      return;
    }
    if (message.revision <= this.revision) return;
    this.revision = message.revision;
    this.options.onAvailability?.(true);
    this.options.onSnapshot?.(message.value, message.revision);
  }

  private async handleRequest(message: Extract<SyncMessage, { kind: 'request' }>) {
    const key = `${message.sourceId}\u0000${message.requestId}`;
    const cached = this.dedupe.get(key);
    if (cached) { this.adapter.send(cached); return; }
    const active = this.inFlight.get(key);
    if (active) { this.adapter.send(await active); return; }
    const operation = (async (): Promise<SyncMessage> => {
      let reply: SyncMessage;
      try {
        if (!this.options.onRequest) throw new Error('Runtime request handler is unavailable');
        const value = await this.options.onRequest(structuredClone(message.request), message.sourceId);
        reply = { kind: 'reply', sourceId: this.sourceId, destination: message.sourceId, requestId: message.requestId,
          revision: ++this.revision, ok: true, value: structuredClone(value) };
      } catch {
        reply = { kind: 'reply', sourceId: this.sourceId, destination: message.sourceId, requestId: message.requestId,
          revision: ++this.revision, ok: false, error: 'Runtime request failed' };
      }
      this.dedupe.set(key, reply);
      if (this.dedupe.size > 256) this.dedupe.delete(this.dedupe.keys().next().value!);
      return reply;
    })();
    this.inFlight.set(key, operation);
    try { this.adapter.send(await operation); }
    finally { this.inFlight.delete(key); }
  }
}

export async function openRuntimeSync(sourceId: string = newId(), options: SyncOptions = {}) {
  if (isTauri()) {
    let sync: RuntimeSync;
    const unlisten = await listen<SyncMessage>(CHANNEL, event => sync?.receiveMessage(event.payload));
    const adapter: SyncAdapter = {
      send: message => {
        if ('destination' in message && message.destination) {
          const windowLabel = message.destination === 'panel' || message.destination === 'main' ? message.destination : 'panel';
          void emitTo(windowLabel, CHANNEL, message);
        } else void emit(CHANNEL, message);
      },
      close: () => { unlisten(); },
    };
    sync = new RuntimeSync(sourceId, adapter, options);
    return sync;
  }
  const channel = new BroadcastChannel(CHANNEL);
  let sync: RuntimeSync;
  channel.onmessage = event => sync?.receiveMessage(event.data);
  const adapter: SyncAdapter = { send: message => channel.postMessage(message), close: () => channel.close() };
  sync = new RuntimeSync(sourceId, adapter, options);
  return sync;
}

/** A single browser dashboard tab holds this Web Lock while it owns automation and persistence. */
export function browserRuntimeLease(onAcquire: () => Promise<void>, onRelease: () => Promise<void>) {
  let stopped = false, release: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const locks = navigator.locks;
  if (!locks) return { stop: async () => { stopped = true; } };
  const attempt = () => {
    if (stopped) return;
    void locks.request('supadashboard-runtime-v1', { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) { timer = setTimeout(attempt, 1000); return; }
      await onAcquire();
      await new Promise<void>(resolve => { release = resolve; });
      release = undefined;
      await onRelease();
      if (!stopped) timer = setTimeout(attempt, 0);
    }).catch(() => { if (!stopped) timer = setTimeout(attempt, 1000); });
  };
  attempt();
  return { stop: async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    release?.();
    await Promise.resolve();
  } };
}

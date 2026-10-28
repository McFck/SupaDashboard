import { emit, emitTo, listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { newId } from '../../features/automation/scenario';
import { validMessage, type RuntimeRequest, type SyncMessage } from './protocol';

export type SyncAdapter = { send(message: SyncMessage): void; close(): void };
export type SyncOptions = {
  owner?: boolean;
  onRequest?: (request: RuntimeRequest, sourceId: string) => unknown | Promise<unknown>;
  onSnapshot?: (snapshot: unknown, revision: number) => void;
  onAvailability?: (online: boolean) => void;
};

const CHANNEL = 'supadashboard:runtime:v1';

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/** Request/reply protocol shared by Tauri webviews and browser BroadcastChannel tabs. */
export class RuntimeSync {
  private pending = new Map<string, Pending>();
  private revision = 0;
  private closed = false;
  constructor(
    readonly sourceId: string,
    private adapter: SyncAdapter,
    private options: SyncOptions = {},
  ) {}

  request(request: RuntimeRequest, timeoutMs = 2000) {
    if (this.closed) return Promise.reject(new Error('Runtime connection is closed'));
    const message = {
      kind: 'request',
      sourceId: this.sourceId,
      requestId: 'check',
      revision: this.revision,
      request,
    };
    if (!validMessage(message)) {
      return Promise.reject(new Error('Invalid runtime request'));
    }
    const requestId = newId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Runtime owner is unavailable'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.adapter.send({
        kind: 'request',
        sourceId: this.sourceId,
        requestId,
        revision: this.revision,
        request: structuredClone(request),
      });
    });
  }

  publish(value: unknown, destination?: string) {
    if (!this.options.owner || this.closed) return;
    this.revision++;
    this.adapter.send({
      kind: 'snapshot',
      sourceId: this.sourceId,
      ...(destination ? { destination } : {}),
      revision: this.revision,
      value: structuredClone(value),
    });
  }

  get currentRevision() {
    return this.revision;
  }
  receiveMessage(message: unknown) {
    this.receive(message);
  }
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
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Runtime connection closed'));
    }
    this.pending.clear();
    this.options.onAvailability?.(false);
  }

  private receive(value: unknown) {
    if (this.closed || !validMessage(value)) return;
    const message = value;
    if (
      message.sourceId === this.sourceId ||
      ('destination' in message && message.destination && message.destination !== this.sourceId)
    )
      return;
    if (message.kind === 'request') {
      if (this.options.owner) void this.handleRequest(message);
      return;
    }
    if (message.kind === 'reply') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.revision < this.revision) pending.reject(new Error('Stale runtime reply'));
      else {
        this.revision = message.revision;
        if (message.ok) {
          this.options.onAvailability?.(true);
          pending.resolve(message.value);
        } else pending.reject(new Error(message.error || 'Runtime request failed'));
      }
      return;
    }
    if (message.revision <= this.revision) return;
    this.revision = message.revision;
    this.options.onAvailability?.(true);
    this.options.onSnapshot?.(message.value, message.revision);
  }

  private async handleRequest(message: Extract<SyncMessage, { kind: 'request' }>) {
    const reply = {
      kind: 'reply' as const,
      sourceId: this.sourceId,
      destination: message.sourceId,
      requestId: message.requestId,
    };
    try {
      if (!this.options.onRequest) throw new Error('Runtime request handler is unavailable');
      const value = await this.options.onRequest(
        structuredClone(message.request),
        message.sourceId,
      );
      this.adapter.send({
        ...reply,
        revision: ++this.revision,
        ok: true,
        value: structuredClone(value),
      });
    } catch {
      this.adapter.send({
        ...reply,
        revision: ++this.revision,
        ok: false,
        error: 'Runtime request failed',
      });
    }
  }
}

export async function openRuntimeSync(sourceId: string = newId(), options: SyncOptions = {}) {
  if (isTauri()) {
    let sync: RuntimeSync;
    const unlisten = await listen<SyncMessage>(CHANNEL, (event) =>
      sync?.receiveMessage(event.payload),
    );
    const adapter: SyncAdapter = {
      send: (message) => {
        if ('destination' in message && message.destination) {
          const windowLabel =
            message.destination === 'panel' || message.destination === 'main'
              ? message.destination
              : 'panel';
          void emitTo(windowLabel, CHANNEL, message);
        } else void emit(CHANNEL, message);
      },
      close: () => {
        unlisten();
      },
    };
    sync = new RuntimeSync(sourceId, adapter, options);
    return sync;
  }
  const channel = new BroadcastChannel(CHANNEL);
  let sync: RuntimeSync;
  channel.onmessage = (event) => sync?.receiveMessage(event.data);
  const adapter: SyncAdapter = {
    send: (message) => channel.postMessage(message),
    close: () => channel.close(),
  };
  sync = new RuntimeSync(sourceId, adapter, options);
  return sync;
}

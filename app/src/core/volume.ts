import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { get, readonly, writable, type Readable } from 'svelte/store';

export type Channel = { target: string; volume: number; muted: boolean; label?: string; icon?: string };
export type LocalVolumeAdapter = {
  label?: string;
  icon?: string;
  read(): { volume: number; muted: boolean } | null;
  setVolume(value: number): void | Promise<void>;
  setMuted(muted: boolean): void | Promise<void>;
  subscribe?(listener: () => void): () => void;
};
type Snapshot = { revision: number; deviceId: string | null; channels: Channel[] };
type Patch = { value?: number; muted?: boolean };
type Waiter = { resolve: () => void; reject: (error: Error) => void; settled: boolean };
type Job = { patch: Patch; generation: number; deviceId: string; waiters: Waiter[]; epoch: number };
type Queue = {
  generation: number;
  pending: Job | null;
  inFlight: Job | null;
  timer: ReturnType<typeof setTimeout> | null;
  lastSentAt: number;
};

const sendInterval = 50;
const state = writable<Channel[]>([]);
export const volumeChannels: Readable<Channel[]> = readonly(state);
let canonical: Snapshot | null = null;
let unlistenAudio: (() => void) | null = null;
let initPromise: Promise<void> | null = null;
let lifecycle = 0;
let disposed = false;
let generation = 0;
const queues = new Map<string, Queue>();
const optimistic = new Map<string, { patch: Patch; generation: number }>();
const localChannels = new Map<string, { adapter: LocalVolumeAdapter; stop?: () => void }>();

function normalizeTarget(target: string) {
  const normalized = target.trim().toLowerCase();
  return normalized.endsWith('.exe') ? normalized.slice(0, -4) : normalized;
}

export function findVolumeChannel(channels: Channel[], target: string): Channel | null {
  const normalized = normalizeTarget(target);
  if (!normalized) return null;
  const exact = channels.find(channel => normalizeTarget(channel.target) === normalized);
  if (exact) return exact;
  return channels.find(channel => {
    const channelTarget = normalizeTarget(channel.target);
    return normalized === 'system' ? channelTarget === 'system' : channelTarget.includes(normalized);
  }) ?? null;
}

function canonicalize(snapshot: unknown): Snapshot | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const raw = snapshot as Partial<Snapshot>;
  if (!Number.isSafeInteger(raw.revision) || (raw.revision ?? -1) < 0 ||
    !(raw.deviceId === null || (typeof raw.deviceId === 'string' && raw.deviceId.length > 0)) ||
    !Array.isArray(raw.channels)) return null;
  const channels: Channel[] = [];
  for (const channel of raw.channels) {
    if (!channel || typeof channel !== 'object') return null;
    const item = channel as Partial<Channel>;
    if (typeof item.target !== 'string' || !normalizeTarget(item.target) ||
      typeof item.volume !== 'number' || !Number.isFinite(item.volume) || item.volume < 0 || item.volume > 1 ||
      typeof item.muted !== 'boolean') return null;
    channels.push({ target: normalizeTarget(item.target), volume: item.volume, muted: item.muted });
  }
  channels.sort((a, b) => a.target === b.target ? 0 : a.target === 'system' ? -1
    : b.target === 'system' ? 1 : a.target.localeCompare(b.target));
  const unique = channels.filter((channel, index) => index === 0 || channels[index - 1].target !== channel.target);
  if (raw.deviceId === null && unique.length) return null;
  return { revision: raw.revision!, deviceId: raw.deviceId!, channels: unique };
}

function settle(waiter: Waiter, error?: Error) {
  if (waiter.settled) return;
  waiter.settled = true;
  if (error) waiter.reject(error);
  else waiter.resolve();
}

function publish() {
  const native = canonical?.channels.map(channel => {
    const updates = [...optimistic.entries()].sort((a, b) => a[1].generation - b[1].generation);
    let visible = channel;
    for (const [target, update] of updates) {
      if (findVolumeChannel(canonical!.channels, target)?.target === channel.target) {
        visible = {
          ...visible,
          ...(update.patch.value === undefined ? {} : { volume: update.patch.value }),
          ...(update.patch.muted === undefined ? {} : { muted: update.patch.muted }),
        };
      }
    }
    return visible;
  }) ?? [];
  const local = [...localChannels].flatMap(([target, entry]) => {
    let snapshot: ReturnType<LocalVolumeAdapter['read']>;
    try { snapshot = entry.adapter.read(); } catch { snapshot = null; }
    if (!snapshot || !Number.isFinite(snapshot.volume) || typeof snapshot.muted !== 'boolean' ||
      native.some(channel => normalizeTarget(channel.target) === target)) return [];
    return [{ target, volume: Math.max(0, Math.min(1, snapshot.volume)), muted: snapshot.muted,
      ...(entry.adapter.label ? { label: entry.adapter.label } : {}),
      ...(entry.adapter.icon ? { icon: entry.adapter.icon } : {}) }];
  });
  state.set([...native, ...local]);
}

/** Register an in-process mixer row. Local writes never initialize or invoke native audio. */
export function registerLocalVolumeChannel(target: string, adapter: LocalVolumeAdapter): () => void {
  const normalized = normalizeTarget(target);
  if (!normalized) throw new Error('Volume target cannot be empty');
  if (localChannels.has(normalized)) throw new Error(`Local volume target "${normalized}" is already registered`);
  if (canonical?.channels.some(channel => normalizeTarget(channel.target) === normalized))
    throw new Error(`Volume target "${normalized}" is already provided by the system`);
  const entry: { adapter: LocalVolumeAdapter; stop?: () => void } = { adapter };
  localChannels.set(normalized, entry);
  entry.stop = adapter.subscribe?.(publish);
  publish();
  return () => {
    if (localChannels.get(normalized) !== entry) return;
    entry.stop?.();
    localChannels.delete(normalized);
    publish();
  };
}

function cancelQueue(target: string, queue: Queue, reason: string) {
  if (queue.timer) clearTimeout(queue.timer);
  queue.timer = null;
  const error = new Error(reason);
  for (const job of [queue.pending, queue.inFlight]) {
    for (const waiter of job?.waiters ?? []) settle(waiter, error);
  }
  queue.pending = null;
  queue.inFlight = null;
  if (queues.get(target) === queue) queues.delete(target);
  optimistic.delete(target);
}

function cancelAll(reason: string) {
  for (const [target, queue] of queues) cancelQueue(target, queue, reason);
  optimistic.clear();
  publish();
}

function ingestSnapshot(raw: unknown, epoch = lifecycle) {
  if (disposed || epoch !== lifecycle) return;
  const next = canonicalize(raw);
  if (!next || (canonical && next.revision <= canonical.revision)) return;
  const deviceChanged = canonical !== null && canonical.deviceId !== next.deviceId;
  canonical = next;
  if (deviceChanged) cancelAll('Audio device changed before the volume update was applied');
  else {
    for (const [target, queue] of [...queues]) {
      if (!findVolumeChannel(next.channels, target)) cancelQueue(target, queue, 'Volume target is no longer available');
    }
    publish();
  }
}

export function initVolumeSync(): Promise<void> {
  if (initPromise) return initPromise;
  disposed = false;
  const epoch = lifecycle;
  const initializing = (async () => {
    if (!isTauri()) return;
    try {
      const stop = await listen<unknown>('audio-state', event => ingestSnapshot(event.payload, epoch));
      if (disposed || epoch !== lifecycle) {
        stop();
        return;
      }
      unlistenAudio = stop;
      ingestSnapshot(await invoke<unknown>('audio_snapshot'), epoch);
    } catch (error) {
      if (epoch === lifecycle) {
        unlistenAudio?.();
        unlistenAudio = null;
        canonical = null;
        cancelAll('Volume sync initialization failed');
        initPromise = null;
      }
      throw error;
    }
  })();
  initPromise = initializing;
  return initializing;
}

export async function readVolume(target: string): Promise<number | null> {
  const normalized = normalizeTarget(target);
  const local = localChannels.get(normalized);
  if (local) {
    try {
      const snapshot = local.adapter.read();
      return snapshot && Number.isFinite(snapshot.volume) ? Math.max(0, Math.min(1, snapshot.volume)) : null;
    } catch { return null; }
  }
  await initVolumeSync();
  return findVolumeChannel(get(state), target)?.volume ?? null;
}

function scheduleFlush(target: string, queue: Queue) {
  if (disposed || queue.inFlight || !queue.pending) return;
  const delay = Math.max(0, sendInterval - (Date.now() - queue.lastSentAt));
  if (delay === 0) {
    void flush(target, queue);
  } else if (!queue.timer) {
    queue.timer = setTimeout(() => {
      queue.timer = null;
      void flush(target, queue);
    }, delay);
  }
}

async function flush(target: string, queue: Queue) {
  if (disposed || queue.inFlight || !queue.pending || queues.get(target) !== queue) return;
  if (queue.timer) clearTimeout(queue.timer);
  queue.timer = null;
  const job = queue.pending;
  queue.pending = null;
  queue.inFlight = job;
  queue.lastSentAt = Date.now();
  try {
    const result = await invoke<{ applied: boolean; snapshot: unknown }>('audio_update', {
      target,
      deviceId: job.deviceId,
      ...job.patch,
    });
    if (disposed || job.epoch !== lifecycle || queues.get(target) !== queue) return;
    if (!result || typeof result.applied !== 'boolean' || !('snapshot' in result)) {
      throw new Error('Core Audio returned an invalid update result');
    }
    ingestSnapshot(result.snapshot, job.epoch);
    if (queues.get(target) !== queue) return;
    if (!result.applied) {
      if (optimistic.get(target)?.generation === job.generation) optimistic.delete(target);
      for (const waiter of job.waiters) settle(waiter, new Error('Volume target is no longer available'));
      publish();
    } else {
      if (optimistic.get(target)?.generation === job.generation) {
        optimistic.delete(target);
        publish();
      }
      for (const waiter of job.waiters) settle(waiter);
    }
  } catch (error) {
    if (disposed || job.epoch !== lifecycle || queues.get(target) !== queue) return;
    if (optimistic.get(target)?.generation === job.generation) {
      optimistic.delete(target);
      publish();
    }
    for (const waiter of job.waiters) settle(waiter, error instanceof Error ? error : new Error(String(error)));
  } finally {
    if (queues.get(target) === queue) {
      queue.inFlight = null;
      if (queue.pending) scheduleFlush(target, queue);
    }
  }
}

async function update(target: string, patch: Patch): Promise<void> {
  const normalized = normalizeTarget(target);
  if (!normalized) throw new Error('Volume target cannot be empty');
  if (patch.value !== undefined && !Number.isFinite(patch.value)) throw new Error('Volume must be finite');
  if (patch.value !== undefined) patch.value = Math.max(0, Math.min(1, patch.value));
  const local = localChannels.get(normalized);
  if (local) {
    if (patch.value !== undefined) await local.adapter.setVolume(patch.value);
    if (patch.muted !== undefined) await local.adapter.setMuted(patch.muted);
    publish();
    return;
  }
  await initVolumeSync();
  const channel = findVolumeChannel(canonical?.channels ?? [], normalized);
  const deviceId = canonical?.deviceId;
  if (!channel || !deviceId) throw new Error(`Volume target "${normalized}" is unavailable`);

  let queue = queues.get(normalized);
  if (!queue) {
    queue = { generation: 0, pending: null, inFlight: null, timer: null, lastSentAt: Number.NEGATIVE_INFINITY };
    queues.set(normalized, queue);
  }
  const nextGeneration = ++generation;
  queue.generation = nextGeneration;
  const waiter: Waiter = { resolve: () => {}, reject: () => {}, settled: false };
  const promise = new Promise<void>((resolve, reject) => {
    waiter.resolve = resolve;
    waiter.reject = reject;
  });
  const pending = queue.pending;
  const merged: Patch = { ...(pending?.patch ?? {}), ...patch };
  const waiters = [...(pending?.waiters ?? []), waiter];
  queue.pending = { patch: merged, generation: nextGeneration, deviceId, waiters, epoch: lifecycle };
  optimistic.set(normalized, {
    patch: { ...(optimistic.get(normalized)?.patch ?? {}), ...patch },
    generation: nextGeneration,
  });
  publish();
  scheduleFlush(normalized, queue);
  return promise;
}

export function setVolume(target: string, value: number): Promise<void> {
  return update(target, { value });
}

export function setMuted(target: string, muted: boolean): Promise<void> {
  return update(target, { muted });
}

function dispose() {
  disposed = true;
  lifecycle++;
  unlistenAudio?.();
  unlistenAudio = null;
  initPromise = null;
  canonical = null;
  cancelAll('Volume sync was disposed');
  publish();
  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', dispose);
}

if (typeof window !== 'undefined') window.addEventListener('beforeunload', dispose);
if (import.meta.hot) import.meta.hot.dispose(dispose);

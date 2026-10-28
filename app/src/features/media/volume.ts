import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { get, readonly, writable, type Readable } from 'svelte/store';
import {
  applyVolumePatch,
  clampVolume,
  normalizeTarget,
  parseVolumeSnapshot,
  type Channel,
  type VolumePatch,
  type VolumeSnapshot,
} from './volume-model';
import { VolumeWriteQueue } from './volume-queue';

export type { Channel } from './volume-model';
export type LocalVolumeAdapter = {
  label?: string;
  icon?: string;
  read(): { volume: number; muted: boolean } | null;
  setVolume(value: number): void | Promise<void>;
  setMuted(muted: boolean): void | Promise<void>;
  subscribe?(listener: () => void): () => void;
};
type LocalEntry = { adapter: LocalVolumeAdapter; stop?: () => void };

const state = writable<Channel[]>([]);
export const volumeChannels: Readable<Channel[]> = readonly(state);
let canonical: VolumeSnapshot | null = null;
let unlistenAudio: (() => void) | null = null;
let initPromise: Promise<void> | null = null;
/** Bumped on dispose, so a listener or snapshot from an earlier init is dropped. */
let lifecycle = 0;
let disposed = false;
const localChannels = new Map<string, LocalEntry>();
const writes = new VolumeWriteQueue({
  send: (target, deviceId, patch) =>
    invoke<unknown>('audio_update', { target, deviceId, ...patch }),
  ingest: (snapshot) => ingestSnapshot(snapshot, lifecycle),
  changed: publish,
});

export function findVolumeChannel(channels: Channel[], target: string): Channel | null {
  const normalized = normalizeTarget(target);
  if (!normalized) {
    return null;
  }
  const exact = channels.find((channel) => normalizeTarget(channel.target) === normalized);
  if (exact) {
    return exact;
  }
  // Legacy selectors may name part of a process; local targets only ever match exactly.
  return (
    channels.find((channel) => {
      const channelTarget = normalizeTarget(channel.target);
      if (localChannels.has(channelTarget)) {
        return false;
      }
      return normalized === 'system'
        ? channelTarget === 'system'
        : channelTarget.includes(normalized);
    }) ?? null
  );
}

function readLocal(entry: LocalEntry) {
  try {
    return entry.adapter.read();
  } catch {
    return null;
  }
}

function nativeChannels() {
  if (!canonical) {
    return [];
  }
  const native = canonical.channels;
  const updates = writes
    .optimisticPatches()
    .map(([target, patch]) => [findVolumeChannel(native, target)?.target, patch] as const);
  return native.map((channel) =>
    updates.reduce(
      (visible, [target, patch]) =>
        target === channel.target ? applyVolumePatch(visible, patch) : visible,
      channel,
    ),
  );
}

function publish() {
  const native = nativeChannels();
  const local = [...localChannels].flatMap(([target, entry]): Channel[] => {
    const snapshot = readLocal(entry);
    if (
      !snapshot ||
      !Number.isFinite(snapshot.volume) ||
      typeof snapshot.muted !== 'boolean' ||
      native.some((channel) => normalizeTarget(channel.target) === target)
    ) {
      return [];
    }
    return [
      {
        target,
        volume: clampVolume(snapshot.volume),
        muted: snapshot.muted,
        ...(entry.adapter.label ? { label: entry.adapter.label } : {}),
        ...(entry.adapter.icon ? { icon: entry.adapter.icon } : {}),
      },
    ];
  });
  state.set([...native, ...local]);
}

/** Register an in-process mixer row. Local writes never initialize or invoke native audio. */
export function registerLocalVolumeChannel(
  target: string,
  adapter: LocalVolumeAdapter,
): () => void {
  const normalized = normalizeTarget(target);
  if (!normalized) {
    throw new Error('Volume target cannot be empty');
  }
  if (localChannels.has(normalized)) {
    throw new Error(`Local volume target "${normalized}" is already registered`);
  }
  if (canonical?.channels.some((channel) => normalizeTarget(channel.target) === normalized)) {
    throw new Error(`Volume target "${normalized}" is already provided by the system`);
  }
  const entry: LocalEntry = { adapter };
  localChannels.set(normalized, entry);
  try {
    entry.stop = adapter.subscribe?.(publish);
  } catch (error) {
    localChannels.delete(normalized);
    throw error;
  }
  publish();
  return () => {
    if (localChannels.get(normalized) !== entry) {
      return;
    }
    entry.stop?.();
    localChannels.delete(normalized);
    publish();
  };
}

function ingestSnapshot(raw: unknown, epoch: number) {
  if (disposed || epoch !== lifecycle) {
    return;
  }
  const next = parseVolumeSnapshot(raw);
  if (!next || (canonical && next.revision <= canonical.revision)) {
    return;
  }
  const deviceChanged = canonical !== null && canonical.deviceId !== next.deviceId;
  canonical = next;
  if (deviceChanged) {
    writes.cancelAll('Audio device changed before the volume update was applied');
    return;
  }
  writes.cancelWhere(
    (target) => !findVolumeChannel(next.channels, target),
    'Volume target is no longer available',
  );
  publish();
}

export function initVolumeSync(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }
  disposed = false;
  const epoch = lifecycle;
  initPromise = (async () => {
    if (!isTauri()) {
      return;
    }
    try {
      const stop = await listen<unknown>('audio-state', (event) =>
        ingestSnapshot(event.payload, epoch),
      );
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
        writes.cancelAll('Volume sync initialization failed');
        initPromise = null;
      }
      throw error;
    }
  })();
  return initPromise;
}

export async function readVolume(target: string): Promise<number | null> {
  const local = localChannels.get(normalizeTarget(target));
  if (local) {
    const snapshot = readLocal(local);
    return snapshot && Number.isFinite(snapshot.volume) ? clampVolume(snapshot.volume) : null;
  }
  await initVolumeSync();
  return findVolumeChannel(get(state), target)?.volume ?? null;
}

async function update(target: string, patch: VolumePatch): Promise<void> {
  const normalized = normalizeTarget(target);
  if (!normalized) {
    throw new Error('Volume target cannot be empty');
  }
  if (patch.value !== undefined && !Number.isFinite(patch.value)) {
    throw new Error('Volume must be finite');
  }
  const clamped = patch.value === undefined ? patch : { ...patch, value: clampVolume(patch.value) };
  const local = localChannels.get(normalized);
  if (local) {
    if (clamped.value !== undefined) {
      await local.adapter.setVolume(clamped.value);
    }
    if (clamped.muted !== undefined) {
      await local.adapter.setMuted(clamped.muted);
    }
    publish();
    return;
  }
  await initVolumeSync();
  const channel = findVolumeChannel(canonical?.channels ?? [], normalized);
  const deviceId = canonical?.deviceId;
  if (!channel || !deviceId) {
    throw new Error(`Volume target "${normalized}" is unavailable`);
  }
  return writes.enqueue(normalized, deviceId, clamped);
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
  writes.cancelAll('Volume sync was disposed');
  if (typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', dispose);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', dispose);
}
if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}

// Windows media sessions as a now-playing source: one native subscription shared by every provider.
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isRecord } from '../features/automation/plain-data';
import { markNative } from '../features/media/now-playing';
import { MAX_SESSIONS, readSourceState } from '../features/media/now-playing-read';
import type { NowPlayingSourceState, StatusSourceDef } from '../features/plugins/contracts';

/** Ask again this long after the native side failed to start. */
const RETRY_MS = 5000;

/** The raw `media-sessions` payload, or null when the native subscription failed. */
type Listener = (raw: unknown) => void;

const listeners = new Set<Listener>();
let latest: unknown;
/** Bumped on every start and stop, so a late event or a finished native call is dropped. */
let epoch = 0;
let unlisten: (() => void) | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
/** Native calls run in order: a stop can never overtake the start it follows. */
let queue: Promise<unknown> = Promise.resolve();

const enqueue = (job: () => Promise<void>) => (queue = queue.catch(() => {}).then(job));

function deliver(raw: unknown) {
  latest = raw;
  for (const listener of [...listeners]) {
    listener(raw);
  }
}

function startHub() {
  const mine = ++epoch;
  enqueue(async () => {
    if (mine !== epoch) {
      return;
    }
    unlisten?.();
    unlisten = await listen<unknown>('media-sessions', (event) => {
      if (mine === epoch) {
        deliver(event.payload);
      }
    });
    const snapshot = await invoke<unknown>('media_sessions_subscribe');
    if (mine === epoch && snapshot) {
      deliver(snapshot);
    }
  }).catch(() => {
    if (mine === epoch) {
      deliver(null);
      retry = setTimeout(startHub, RETRY_MS);
    }
  });
}

function stopHub() {
  epoch++;
  clearTimeout(retry);
  latest = undefined;
  enqueue(async () => {
    unlisten?.();
    unlisten = undefined;
    await invoke('media_sessions_unsubscribe');
  }).catch(() => {
    // The worker also stops when the window closes; a failed release only delays that.
  });
}

function join(listener: Listener) {
  if (!listeners.size) {
    startHub();
  }
  listeners.add(listener);
  if (latest !== undefined) {
    listener(latest);
  }
  return () => {
    if (listeners.delete(listener) && !listeners.size) {
      stopHub();
    }
  };
}

function toState(raw: unknown, selector?: string): NowPlayingSourceState {
  if (!isRecord(raw) || raw.available !== true || !Array.isArray(raw.sessions)) {
    return { state: 'unavailable' };
  }
  if (!raw.sessions.every((item) => isRecord(item) && typeof item.appId === 'string')) {
    return { state: 'unavailable' };
  }
  const sessions = raw.sessions
    .filter((item) => !selector || item.appId.toLowerCase().includes(selector))
    .slice(0, MAX_SESSIONS)
    .map((item) =>
      markNative({ ...item, sessionId: item.id }, { id: String(item.id), appId: item.appId }),
    );
  return readSourceState({ state: 'ready', sessions }) ?? { state: 'unavailable' };
}

/**
 * Sessions from Windows' media controls. `selector` keeps only apps whose id contains it
 * (the same match `media_command` uses); without it every session is reported.
 */
export function nativeSessions(selector?: string): StatusSourceDef['subscribe'] {
  return (emit) => {
    if (!isTauri()) {
      emit({ state: 'unavailable' });
      return () => {};
    }
    return join((raw) => emit(toState(raw, selector?.toLowerCase())));
  };
}

/** The asset URL for a cover the native cache issued a handle for, or null when it is gone. */
export async function resolveArtwork(handle: string) {
  const path = await invoke<string | null>('media_artwork_resolve', { handle });
  return path ? convertFileSrc(path) : null;
}

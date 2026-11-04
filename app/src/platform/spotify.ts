import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isRecord } from '../features/automation/plain-data';
import { ActionFailure } from '../features/automation/action-failure';

export type SpotifyView =
  | { state: 'needsAuth' | 'connecting'; error?: string }
  | {
      state: 'ready';
      user: string;
      trackUri: string | null;
      liked: boolean | null;
      smartShuffle: boolean;
      shuffle?: boolean;
      error?: string;
    };
type SpotifyCommand = 'like' | 'unlike' | 'dislike';
const validId = (id: string) => /^[a-fA-F0-9]{32}$/.test(id);
const validText = (text: unknown): text is string =>
  typeof text === 'string' &&
  text.trim().length > 0 &&
  text.length <= 512 &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(text);

export function readSpotifyView(raw: unknown): SpotifyView | undefined {
  if (!isRecord(raw) || (raw.error != null && !validText(raw.error))) {
    return undefined;
  }
  const error = typeof raw.error === 'string' ? { error: raw.error } : {};
  if (raw.state === 'needsAuth' || raw.state === 'connecting') {
    return { state: raw.state, ...error };
  }
  if (
    raw.state !== 'ready' ||
    !validText(raw.user) ||
    (raw.trackUri !== null &&
      (typeof raw.trackUri !== 'string' ||
        !/^spotify:track:[a-zA-Z0-9]{22}$/.test(raw.trackUri))) ||
    (raw.liked !== null && typeof raw.liked !== 'boolean') ||
    typeof raw.smartShuffle !== 'boolean' ||
    (raw.shuffle !== undefined && typeof raw.shuffle !== 'boolean') ||
    (raw.trackUri === null && raw.liked !== null)
  ) {
    return undefined;
  }
  return {
    state: 'ready',
    user: raw.user,
    trackUri: raw.trackUri,
    liked: raw.liked,
    smartShuffle: raw.smartShuffle,
    ...(typeof raw.shuffle === 'boolean' ? { shuffle: raw.shuffle } : {}),
    ...error,
  };
}

const listeners = new Set<(view: SpotifyView) => void>();
let latest: SpotifyView = { state: 'needsAuth' };
let epoch = 0;
let unlisten: (() => void) | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (job: () => Promise<void>) =>
  (queue = queue
    .catch(() => {
      // Failed starts are reported below; cleanup must still run.
    })
    .then(job));

function deliver(raw: unknown) {
  latest = readSpotifyView(raw) ?? { state: 'needsAuth', error: 'Invalid Spotify state' };
  for (const listener of [...listeners]) {
    listener(latest);
  }
}

function startHub() {
  const mine = ++epoch;
  enqueue(async () => {
    if (mine !== epoch) {
      return;
    }
    unlisten?.();
    let receivedEvent = false;
    unlisten = await listen<unknown>('spotify-state', (event) => {
      if (mine === epoch) {
        receivedEvent = true;
        deliver(event.payload);
      }
    });
    const snapshot = await invoke<unknown>('spotify_subscribe');
    if (mine === epoch && !receivedEvent) {
      deliver(snapshot);
    }
  }).catch(() => {
    if (mine === epoch) {
      deliver({ state: 'needsAuth', error: 'Spotify unavailable' });
      retry = setTimeout(startHub, 5000);
    }
  });
}

export function subscribeSpotify(listener: (view: SpotifyView) => void): () => void {
  if (!isTauri()) {
    listener({ state: 'needsAuth' });
    return () => {};
  }
  const receive = (view: SpotifyView) => listener(view);
  listeners.add(receive);
  receive(latest);
  if (listeners.size === 1) {
    startHub();
  }
  return () => {
    if (!listeners.delete(receive) || listeners.size) {
      return;
    }
    epoch++;
    clearTimeout(retry);
    latest = { state: 'needsAuth' };
    enqueue(async () => {
      unlisten?.();
      unlisten = undefined;
      await invoke('spotify_unsubscribe');
    }).catch(() => {
      // Native also releases the subscriber when its window closes.
    });
  };
}

async function command(name: string, args?: Record<string, unknown>) {
  if (!isTauri()) {
    throw new Error('Spotify unavailable');
  }
  await queue;
  if (!listeners.size) {
    throw new Error('Connect Spotify first');
  }
  await invoke<void>(name, args);
}

export async function spotifyAuthorize(clientId: string) {
  const id = clientId.trim();
  if (!validId(id)) {
    throw new Error('Invalid Spotify client ID');
  }
  await command('spotify_authorize', { clientId: id });
}

export const spotifyLogout = () => command('spotify_logout');
export const spotifyCommand = (op: SpotifyCommand) => command('spotify_command', { op });

export async function spotifyTransport(command: string) {
  if (!/^(shuffle:(on|off|toggle)|repeat:(off|context|track|cycle))$/.test(command)) {
    throw new Error('Invalid Spotify command');
  }
  if (!isTauri()) {
    throw new Error('Spotify unavailable');
  }
  if (command.startsWith('shuffle:')) {
    try {
      await invoke<void>('spotify_shuffle', { mode: command.slice('shuffle:'.length) });
    } catch {
      throw new ActionFailure('Spotify shuffle failed');
    }
    return;
  }
  const sent = await invoke<boolean>('media_command', { target: 'spotify', command });
  if (!sent) {
    throw new Error("Spotify isn't playing");
  }
}

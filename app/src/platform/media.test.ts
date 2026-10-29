import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NowPlayingSourceState } from '../features/plugins/contracts';

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  handler: null as null | ((event: { payload: unknown }) => void),
  unlisten: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: (...args: unknown[]) => native.invoke(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_name: string, handler: (event: { payload: unknown }) => void) => {
    native.handler = handler;
    return native.unlisten;
  },
}));

const raw = (appId: string, id: string) => ({
  id,
  appId,
  title: 'Song',
  artist: 'Band',
  album: '',
  state: 'playing',
  current: true,
  timeline: null,
  artwork: null,
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const calls = (name: string) => native.invoke.mock.calls.filter(([command]) => command === name);

afterEach(() => {
  vi.clearAllMocks();
});

describe('native session source', () => {
  it('shares one native subscription between providers and releases it after the last', async () => {
    native.invoke.mockResolvedValue(null);
    const { nativeSessions } = await import('./media');
    const all: NowPlayingSourceState[] = [];
    const spotify: NowPlayingSourceState[] = [];
    const signal = new AbortController().signal;
    const stopAll = nativeSessions()((state) => all.push(state), signal);
    const stopSpotify = nativeSessions('spotify')((state) => spotify.push(state), signal);
    await flush();
    expect(calls('media_sessions_subscribe')).toHaveLength(1);
    native.handler?.({
      payload: {
        available: true,
        sessions: [raw('Spotify.exe', 'Spotify.exe#1'), raw('Brave', 'Brave#2')],
      },
    });
    expect(all.at(-1)).toMatchObject({ state: 'ready', sessions: [{}, {}] });
    expect(spotify.at(-1)).toMatchObject({
      state: 'ready',
      sessions: [{ sessionId: 'Spotify.exe#1' }],
    });
    stopAll();
    await flush();
    expect(calls('media_sessions_unsubscribe')).toHaveLength(0);
    stopSpotify();
    await flush();
    expect(calls('media_sessions_unsubscribe')).toHaveLength(1);
  });

  it('reports unavailable for a malformed or unreachable native payload', async () => {
    native.invoke.mockResolvedValue(null);
    const { nativeSessions } = await import('./media');
    const seen: NowPlayingSourceState[] = [];
    const stop = nativeSessions()((state) => seen.push(state), new AbortController().signal);
    await flush();
    native.handler?.({ payload: { available: true, sessions: [{ id: 5 }] } });
    expect(seen.at(-1)).toEqual({ state: 'unavailable' });
    native.handler?.({ payload: { available: false, sessions: [] } });
    expect(seen.at(-1)).toEqual({ state: 'unavailable' });
    stop();
  });
});

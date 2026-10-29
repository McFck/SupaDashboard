import { describe, expect, it } from 'vitest';
import type { NowPlayingSession } from '../plugins/contracts';
import {
  markNative,
  nativeAppKey,
  nativeIdentity,
  progressAt,
  providersFor,
  readNowPlayingOptions,
  selectSession,
  type Candidate,
} from './now-playing';
import { readSourceState, readStatus } from './now-playing-read';

const session = (sessionId: string, patch: Partial<NowPlayingSession> = {}): NowPlayingSession => ({
  sessionId,
  title: 'Song',
  artist: 'Band',
  album: '',
  state: 'playing',
  current: false,
  ...patch,
});
const candidate = (
  provider: string,
  id: string,
  patch: Partial<NowPlayingSession> = {},
  appId?: string,
): Candidate => ({
  provider,
  session: session(id, patch),
  ...(appId ? { native: { id, appId } } : {}),
});

describe('session selection', () => {
  it('never lets a disallowed playing source beat an allowed paused one', () => {
    const spotify = candidate('spotify', 's1', { state: 'paused' }, 'Spotify.exe');
    const brave = candidate('system', 'b1', { state: 'playing' }, 'Brave');
    expect(selectSession([brave, spotify], ['spotify'])?.session.sessionId).toBe('s1');
    expect(selectSession([brave], ['spotify'])).toBeUndefined();
  });

  it('counts a session that System and Spotify both report once, under the named plugin', () => {
    const system = candidate('system', 'Spotify.exe#1', {}, 'Spotify.exe');
    const named = candidate('spotify', 'Spotify.exe#1', {}, 'Spotify.exe');
    expect(selectSession([system, named], [])?.provider).toBe('spotify');
    expect(selectSession([system], [nativeAppKey('Spotify.exe')])?.provider).toBe('system');
  });

  it('keeps the previous pick within a rank, then prefers the current session', () => {
    const a = candidate('system', 'a#1', {}, 'a');
    const b = candidate('system', 'b#1', { current: true }, 'b');
    expect(selectSession([a, b], [])?.session.sessionId).toBe('b#1');
    expect(selectSession([a, b], [], 'system\u0000a#1')?.session.sessionId).toBe('a#1');
    const paused = candidate('system', 'p#1', { state: 'paused', current: true }, 'p');
    expect(selectSession([paused, a], [], 'system\u0000p#1')?.session.sessionId).toBe('a#1');
  });

  it('matches a known app by process name and routes native keys to System', () => {
    const brave = candidate('system', 'Brave#1', {}, 'BraveSoftware.Brave');
    expect(selectSession([brave], ['known-app:brave'])).toBeDefined();
    expect(selectSession([brave], ['known-app:spotify'])).toBeUndefined();
    expect(providersFor(['known-app:brave', 'app:x'], ['system', 'spotify'])).toEqual(['system']);
  });
});

describe('boundaries', () => {
  it('rejects a damaged filter instead of widening it to every source', () => {
    expect(readNowPlayingOptions({ sources: 'spotify' })).toBeNull();
    expect(readNowPlayingOptions({ sources: [1] })).toBeNull();
    expect(readNowPlayingOptions({ sources: Array(40).fill('a') })).toBeNull();
    expect(readNowPlayingOptions({})).toEqual([]);
    expect(readNowPlayingOptions({ sources: ['a', 'a'] })).toEqual(['a']);
  });

  it('rejects malformed emissions and drops unusable timing', () => {
    expect(readSourceState({ state: 'ready', sessions: [session('a'), session('a')] })).toBeNull();
    expect(
      readSourceState({ state: 'ready', sessions: [{ ...session('a'), state: 'x' }] }),
    ).toBeNull();
    const infinite = {
      ...session('a'),
      timeline: { positionMs: Infinity, startMs: 0, endMs: 1, sampledAtMs: 0 },
    };
    const parsed = readSourceState({ state: 'ready', sessions: [infinite] });
    expect(parsed?.state === 'ready' && parsed.sessions[0].timeline).toBeFalsy();
  });

  it('keeps native identity on the adapter objects only', () => {
    const marked = markNative(session('b'), { id: 'b', appId: 'app' });
    const forged = { ...session('c'), native: { id: 'c', appId: 'app' } };
    const parsed = readSourceState({
      state: 'ready',
      sessions: [marked, { ...marked, sessionId: 'd' }, forged],
    });
    const sessions = parsed?.state === 'ready' ? parsed.sessions : [];
    expect(sessions.map((entry) => nativeIdentity(entry)?.id)).toEqual(['b', undefined, undefined]);
  });

  it('reads an older owner snapshot as empty and refuses a status carrying an unsafe cover URL', () => {
    expect(readStatus(undefined)).toEqual({ catalogue: [], widgets: {} });
    const widget = (artworkUrl: string) => ({
      catalogue: [],
      widgets: {
        c1: {
          unavailable: false,
          artworkUrl,
          candidate: { provider: 'system', session: session('a') },
        },
      },
    });
    expect(readStatus(widget('http://asset.localhost/cover.png'))).not.toBeNull();
    expect(readStatus(widget('https://example.com/cover.png'))).toBeNull();
    expect(readStatus(widget('file:///C:/secret.png'))).toBeNull();
  });
});

describe('playback progress', () => {
  const timeline = { positionMs: 30_000, startMs: 0, endMs: 100_000, sampledAtMs: 1_000_000 };
  it.each([
    ['moves a playing track on from its sample', 'playing', 1_010_000, 0.4],
    ['holds a paused track at its sample', 'paused', 1_010_000, 0.3],
    ['never runs past the end of an old sample', 'playing', 9_000_000, 1],
    ['never moves back for a sample from the future', 'playing', 990_000, 0.3],
  ] as const)('%s', (_name, state, now, expected) => {
    expect(progressAt(session('s', { state, timeline }), now)).toBeCloseTo(expected);
  });
  it('has no progress without timing', () => {
    expect(progressAt(session('s'), 0)).toBeNull();
  });
});

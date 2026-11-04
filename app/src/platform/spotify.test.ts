import { describe, expect, it } from 'vitest';
import { readSpotifyView } from './spotify';
import { readSourceState } from '../features/media/now-playing-read';

describe('Spotify trust boundaries', () => {
  const ready = {
    state: 'ready',
    user: 'Listener',
    trackUri: 'spotify:track:0123456789ABCDEFGHIJKL',
    liked: true,
    smartShuffle: false,
  };
  it('rejects malformed account snapshots and track identities', () => {
    expect(readSpotifyView({ ...ready, extra: 'discard' })).toEqual(ready);
    for (const raw of [
      null,
      {},
      { state: 'unknown' },
      { ...ready, trackUri: 'spotify:track:bad' },
      { ...ready, user: '\u0000' },
      { ...ready, liked: 1 },
      { ...ready, smartShuffle: 'true' },
      { ...ready, trackUri: null },
      { ...ready, error: {} },
    ]) {
      expect(readSpotifyView(raw)).toBeUndefined();
    }
    expect(readSpotifyView({ ...ready, trackUri: null, liked: null })).toEqual({
      ...ready,
      trackUri: null,
      liked: null,
    });
  });
  it('rejects invalid GSMTC shuffle and repeat states at the media boundary', () => {
    const session = {
      sessionId: 'spotify#1',
      title: '',
      artist: '',
      album: '',
      state: 'playing',
      current: true,
      shuffle: true,
      repeat: 'context',
    };
    const snapshot = (next: object) => ({ state: 'ready', sessions: [next] });
    expect(readSourceState(snapshot(session))).toEqual(snapshot(session));
    for (const next of [
      { ...session, repeat: 'unknown' },
      { ...session, shuffle: 1 },
    ]) {
      expect(readSourceState(snapshot(next))).toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_MEDIA_OPTIONS, appendPickedSources, hasMediaExtension, isVideoSource, mediaUrl, readMediaOptions, stepSlide } from './content';

describe('media content options', () => {
  it('returns safe defaults without modifying malformed input', () => {
    const saved = { sources: 'bad', fit: 'stretch', interval: Infinity, loop: 1, muted: null, future: 7 };
    expect(readMediaOptions(saved)).toEqual(DEFAULT_MEDIA_OPTIONS);
    expect(saved.future).toBe(7);
  });

  it('keeps only well-shaped source entries and accepts finite intervals in range', () => {
    expect(readMediaOptions({ sources: [
      { kind: 'url', value: 'https://example.test/a.png' }, { kind: 'file', value: 'C:/a.gif' },
      { kind: 'url', value: 3 }, { kind: 'other', value: 'x' }, { kind: 'file', value: '' }, null,
    ], fit: 'contain', interval: 86400, loop: false, muted: false })).toEqual({
      sources: [{ kind: 'url', value: 'https://example.test/a.png' }, { kind: 'file', value: 'C:/a.gif' }],
      fit: 'contain', interval: 86400, loop: false, muted: false,
    });
    expect(readMediaOptions({ interval: 0 }).interval).toBe(0);
    expect(readMediaOptions({ interval: 86401 }).interval).toBe(DEFAULT_MEDIA_OPTIONS.interval);
  });

  it('accepts absolute HTTP(S) URLs without credentials and rejects other schemes', () => {
    expect(mediaUrl('https://example.test/a')).toBe('https://example.test/a');
    expect(mediaUrl('http://localhost:5186/image')).toBe('http://localhost:5186/image');
    for (const value of ['file:///secret.png', 'data:image/png,x', 'https://user:pass@example.test/x', '/relative.png'])
      expect(mediaUrl(value)).toBeUndefined();
  });

  it('classifies video by URL pathname, ignoring query, hash and case', () => {
    expect(isVideoSource({ kind: 'url', value: 'https://example.test/Clip.MP4?token=1#top' })).toBe(true);
    expect(isVideoSource({ kind: 'url', value: 'https://example.test/video' })).toBe(false);
    expect(isVideoSource({ kind: 'file', value: 'clip.mp4' })).toBe(true);
    expect(isVideoSource({ kind: 'file', value: 'C:/Videos/Clip.MP4' })).toBe(true);
    expect(hasMediaExtension({ kind: 'url', value: 'https://example.test/image.PNG?token=1' })).toBe(true);
    expect(hasMediaExtension({ kind: 'url', value: 'https://example.test/content' })).toBe(false);
  });

  it('wraps or clamps manual and automatic slide steps', () => {
    expect(stepSlide(2, 3, 1, true)).toBe(0);
    expect(stepSlide(0, 3, -1, true)).toBe(2);
    expect(stepSlide(2, 3, 1, false)).toBe(2);
    expect(stepSlide(0, 3, -1, false)).toBe(0);
    expect(stepSlide(20, 3, -1, false)).toBe(1);
    expect(stepSlide(0, 0, 1, true)).toBe(0);
  });

  it('keeps picker cancellation and stale source-list results from overwriting edits', () => {
    const original = [{ kind: 'url' as const, value: 'https://example.test/a.png' }];
    expect(appendPickedSources(original, { sources: original }, null)).toBeUndefined();
    expect(appendPickedSources(original, { sources: [{ kind: 'url', value: 'https://example.test/new.png' }] },
      ['C:/image.png'])).toBeUndefined();
    expect(appendPickedSources(original, { sources: original }, ['C:/image.png', 'C:/video.mp4'])).toEqual([
      ...original, { kind: 'file', value: 'C:/image.png' }, { kind: 'file', value: 'C:/video.mp4' },
    ]);
    expect(original).toEqual([{ kind: 'url', value: 'https://example.test/a.png' }]);
  });
});

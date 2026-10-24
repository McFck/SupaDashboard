import { describe, expect, it } from 'vitest';
import { DEFAULT_MEDIA_OPTIONS, DEFAULT_WEB_OPTIONS, hasMediaExtension, isVideoSource, mediaUrl,
  readMediaOptions, readWebOptions, stepSlide, webUrl } from './content';

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
      sources: [
        { kind: 'url', value: 'https://example.test/a.png', fit: 'contain', loop: true, muted: true },
        { kind: 'file', value: 'C:/a.gif', fit: 'contain', loop: true, muted: true },
      ],
      interval: 86400, loop: false, muted: false,
    });
    expect(readMediaOptions({ interval: 0 }).interval).toBe(0);
    expect(DEFAULT_MEDIA_OPTIONS.interval).toBe(0);
    expect(readMediaOptions({ interval: 86401 }).interval).toBe(DEFAULT_MEDIA_OPTIONS.interval);
  });

  it('keeps fit and video loop/mute preferences on each source', () => {
    expect(readMediaOptions({ sources: [
      { id: 'image', kind: 'file', value: 'C:/a.png', fit: 'contain' },
      { id: 'video', kind: 'url', value: 'https://example.test/a.mp4?x=1', loop: false, muted: false },
    ] }).sources).toEqual([
      { id: 'image', kind: 'file', value: 'C:/a.png', fit: 'contain', loop: true, muted: true },
      { id: 'video', kind: 'url', value: 'https://example.test/a.mp4?x=1', fit: 'cover', loop: false, muted: false },
    ]);
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

});

describe('web content options', () => {
  it('normalizes zoom and refresh without rewriting unrelated options', () => {
    const saved = { url: 'https://example.test', zoom: 250, refresh: 0, interactive: true, future: 'kept' };
    expect(readWebOptions(saved)).toEqual({ url: saved.url, zoom: 200, refresh: 0, interactive: true });
    expect(saved.future).toBe('kept');
    expect(readWebOptions({ zoom: Number.NaN, refresh: Infinity })).toEqual(DEFAULT_WEB_OPTIONS);
    expect(readWebOptions({ zoom: 50, refresh: 1 })).toEqual({ ...DEFAULT_WEB_OPTIONS, zoom: 50, refresh: 1 });
    expect(readWebOptions({ zoom: 150, refresh: 86400 }).refresh).toBe(86400);
    expect(readWebOptions({ zoom: 100, refresh: 86401 }).refresh).toBe(0);
  });

  it('accepts HTTPS and exact localhost HTTP while rejecting internal, credentialed, and app origins', () => {
    expect(webUrl('https://example.test/embed', 'http://localhost:5181')).toBe('https://example.test/embed');
    expect(webUrl('http://localhost:5186/embed', 'http://localhost:5181')).toBe('http://localhost:5186/embed');
    for (const value of [
      'http://127.0.0.1/embed', 'http://localhost.evil.test/', 'ftp://example.test/', 'file:///secret',
      'https://user:pass@example.test/', 'http://tauri.localhost/', 'http://asset.localhost/',
      'https://tauri.localhost/', 'https://example.test/',
    ]) expect(webUrl(value, 'https://example.test')).toBeUndefined();
    expect(webUrl('http://localhost:5181/embed', 'http://localhost:5181')).toBeUndefined();
  });
});

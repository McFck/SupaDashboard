import { describe, expect, it } from 'vitest';
import { catalogEntries, normalizePluginState } from './plugin-store';

describe('plugin store', () => {
  it('keeps valid installation dates and removed ids, dropping malformed data and the retired catalogUrl', () => {
    expect(
      normalizePluginState({
        uninstalled: ['subway', 'subway', 1],
        installed: { spotify: '2026-10-23T12:00:00.000Z', broken: 'yesterday' },
        catalogUrl: 'https://old.example/index.json',
      }),
    ).toEqual({
      uninstalled: ['subway'],
      installed: { spotify: '2026-10-23T12:00:00.000Z' },
    });
    expect(normalizePluginState(null)).toEqual({ uninstalled: [], installed: {} });
  });
  it('never renders or links a malformed catalogue entry', () => {
    const valid = {
      id: 'spike',
      title: 'Spike',
      description: '',
      icon: 'Puzzle',
      version: '1.0.0',
      api: 1,
      published: '2026-11-09',
      size: 1024,
      source: 'https://github.com/McFck/supadashboard-plugins',
      guide: '',
      permissions: {},
    };
    expect(
      catalogEntries([
        valid,
        null,
        { ...valid, id: '../x' },
        { ...valid, title: '' },
        { ...valid, version: 1 },
        { ...valid, api: '1' },
        { ...valid, size: -1 },
        { ...valid, source: 'javascript:alert(1)' },
        { ...valid, source: 'http://example.com' },
        { ...valid, guide: undefined },
        { ...valid, permissions: undefined },
        { ...valid, permissions: { http: 'example.com' } },
      ]).map((entry) => entry.id),
    ).toEqual(['spike']);
    expect(catalogEntries({ plugins: [valid] })).toEqual([]);
  });
});

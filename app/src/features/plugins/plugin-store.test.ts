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
  it('filters malformed entries from remote catalogs', () => {
    const valid = { id: 'remote', title: 'Remote plugin', author: 'Author', icon: 'Puzzle' };
    expect(
      catalogEntries([
        valid,
        null,
        { id: '', title: 'Empty', author: 'Author' },
        { ...valid, author: 5 },
        { ...valid, icon: {} },
        { ...valid, description: [] },
      ]),
    ).toEqual([valid]);
    expect(catalogEntries({ plugins: [valid] })).toEqual([]);
  });
});

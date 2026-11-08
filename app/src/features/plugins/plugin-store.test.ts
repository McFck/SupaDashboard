import { describe, expect, it } from 'vitest';
import { normalizePluginState } from './plugin-store';

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
});

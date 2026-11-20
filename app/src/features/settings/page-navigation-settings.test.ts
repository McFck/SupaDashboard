import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './defaults';
import { migrate } from './normalize';

describe('settings v24 page navigation', () => {
  it('preserves hidden sub-page flag and deduplicated auto-switch app keys across migration', () => {
    const saved = structuredClone(DEFAULTS);
    saved.deck.pages[0] = {
      ...saved.deck.pages[0],
      hidden: true,
      apps: ['exe:C:\\Apps\\Code.exe', 'exe:C:\\Apps\\Code.exe', 'aumid:SpotifyAB.SpotifyMusic'],
    };

    const loaded = migrate(saved);
    expect(loaded.version).toBe(24);
    expect(loaded.deck.pages[0].hidden).toBe(true);
    expect(loaded.deck.pages[0].apps).toEqual([
      'exe:C:\\Apps\\Code.exe',
      'aumid:SpotifyAB.SpotifyMusic',
    ]);
  });

  it('refuses malformed page apps instead of silently dropping them', () => {
    for (const bad of ['exe:C:\\Apps\\Code.exe', ['not-an-app-key'], [123]]) {
      const saved = structuredClone(DEFAULTS) as any;
      saved.deck.pages[0].apps = bad;
      expect(() => migrate(saved)).toThrow('Page apps must be a list of app keys');
    }
  });
});

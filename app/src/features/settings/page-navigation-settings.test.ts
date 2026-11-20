import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './defaults';
import { migrate } from './normalize';

describe('settings v24 page navigation', () => {
  it('preserves hidden sub-page flag and auto-switch rules across migration', () => {
    const saved = structuredClone(DEFAULTS);
    saved.deck.pages[0] = {
      ...saved.deck.pages[0],
      hidden: true,
      autoSwitch: {
        rules: [
          {
            kind: 'compare',
            left: { kind: 'variable', id: 'app.code.focused' },
            op: 'eq',
            right: { kind: 'literal', value: true },
          },
        ],
        returnOnLeave: false,
      },
    };

    const loaded = migrate(saved);
    expect(loaded.version).toBe(24);
    expect(loaded.deck.pages[0].hidden).toBe(true);
    expect(loaded.deck.pages[0].autoSwitch).toEqual({
      rules: [
        {
          kind: 'compare',
          left: { kind: 'variable', id: 'app.code.focused' },
          op: 'eq',
          right: { kind: 'literal', value: true },
        },
      ],
      returnOnLeave: false,
    });
  });

  it('refuses malformed auto-switch rules instead of silently dropping them', () => {
    for (const bad of ['rules', { rules: 'not-array' }, { rules: [{ kind: 'bogus' }] }]) {
      const saved = structuredClone(DEFAULTS) as any;
      saved.deck.pages[0].autoSwitch = bad;
      expect(() => migrate(saved)).toThrow();
    }
  });
});

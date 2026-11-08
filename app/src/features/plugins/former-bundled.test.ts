import { describe, expect, it } from 'vitest';
import { formerBundledDue } from './former-bundled';

describe('former bundled plugins', () => {
  it('reinstalls only plugins the user had, kept and no longer has', () => {
    const date = '2026-10-23T12:00:00.000Z';
    const state = {
      installed: { spotify: date, discord: date, haptics: date, subway: date, spike: date },
      uninstalled: ['discord'],
    };
    expect(formerBundledDue(state, new Set(['haptics']))).toEqual(['spotify', 'subway']);
    expect(formerBundledDue({ installed: {}, uninstalled: [] }, new Set())).toEqual([]);
  });
});

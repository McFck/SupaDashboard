import { describe, expect, it } from 'vitest';
import { appletValues, withAppletValues, withSeparateAppletSettings } from './applet-scope';

const shared = { line: 'yamanote', volume: 0.5 };

describe('applet settings scope', () => {
  it('copies the shared values to every page without its own when switching to separate', () => {
    const entry = withSeparateAppletSettings({ shared, separate: false }, ['p1', 'p2'], true);
    expect(entry.separate).toBe(true);
    expect(appletValues(entry, 'p1')).toEqual(shared);
    const edited = withAppletValues(entry, 'p1', { line: 'ginza' });
    expect(appletValues(edited, 'p1')).toEqual({ line: 'ginza' });
    expect(appletValues(edited, 'p2')).toEqual(shared);
    expect(edited.shared).toEqual(shared);
  });

  it('keeps per-page values when switching back to shared and restores them on the next switch', () => {
    const separate = withAppletValues(
      withSeparateAppletSettings({ shared, separate: false }, ['p1'], true),
      'p1',
      { line: 'ginza' },
    );
    const back = withSeparateAppletSettings(separate, ['p1'], false);
    expect(back.perPage).toEqual({ p1: { line: 'ginza' } });
    expect(appletValues(back, 'p1')).toEqual(shared);
    expect(appletValues(withSeparateAppletSettings(back, ['p1', 'p2'], true), 'p1')).toEqual({
      line: 'ginza',
    });
    expect(appletValues(withSeparateAppletSettings(back, ['p1', 'p2'], true), 'p2')).toEqual(
      shared,
    );
  });
});

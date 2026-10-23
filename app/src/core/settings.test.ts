import { describe, expect, it } from 'vitest';
import { DEFAULTS, migrate } from './settings.svelte';

describe('settings migration', () => {
  it('upgrades v1 settings, keeping the user controls and mapping old icon names', () => {
    const v1 = { version: 1, skin: 'subway', display: { monitor: 'X', fullscreen: true }, variants: { prev: 1 },
      controls: [{ id: 'prev', type: 'button', variants: [{ label: 'All', icon: 'prev', action: { id: 'media.prev', args: { target: 'spotify' } } }] }],
      slots: { 'bottom-strip': ['prev'], dock: ['prev'] } };
    const s = migrate(v1);
    expect(s.version).toBe(4);
    expect(s.skin).toBe('subway');
    expect(s.display).toMatchObject({ monitor: 'X', fullscreen: true, background: { opacity: 0.55 } });
    expect(s.controls[0]).toMatchObject({ id: 'prev', name: 'prev', variants: [{ id: 'state-1', icon: 'SkipBack' }],
      scenario: { triggers: { press: { steps: [{ kind: 'action', action: { args: { source: 'spotify' } } }] } } } });
    expect('slots' in s).toBe(false);
    expect(s.variants).toEqual({ prev: 1 });
  });

  it('turns v2 deck cells into positioned items and moves Spotify bits to the plugin', () => {
    const v2 = { version: 2, skin: 'deck', display: { monitor: null, fullscreen: false }, variants: {},
      controls: [{ id: 'sp', name: 'Spotify', type: 'button', variants: [{ label: 'Open', action: { id: 'open', args: { url: 'spotify:' } } }] }],
      deck: { rows: 2, cols: 3, size: 100, gap: 10, cells: ['', 'sp', '', '', '', 'sp'] } };
    const s = migrate(v2);
    expect(s.deck.items).toEqual([
      { id: 'i1', control: 'sp', x: 1, y: 0, w: 1, h: 1 },
      { id: 'i5', control: 'sp-2', x: 2, y: 1, w: 1, h: 1 },
    ]);
    expect(s.controls.map(c => c.id)).toEqual(['sp', 'sp-2']);
    expect(s.controls[0].scenario?.triggers.press?.steps[0]).toMatchObject({
      kind: 'action', action: { id: 'spotify.open' },
    });
  });

  it('uses defaults for missing data and refuses to overwrite a future settings version', () => {
    expect(migrate(undefined)).toEqual(DEFAULTS);
    expect(() => migrate({ version: 99 })).toThrow('newer than this app supports');
  });

  it('defaults old or malformed always-on-top values and preserves version-4 settings', () => {
    const old = structuredClone(DEFAULTS);
    delete (old.display as Partial<typeof old.display>).alwaysOnTop;
    old.display.monitor = 'DISPLAY-1';
    old.display.fullscreen = true;
    old.display.background = { color: '#123456', opacity: 0.3, radius: 42 };
    old.deck.cols = 4;

    const migrated = migrate(old);
    expect(migrated.display).toEqual({ monitor: 'DISPLAY-1', fullscreen: true, alwaysOnTop: false,
      background: { color: '#123456', opacity: 0.3, radius: 42 } });
    expect(migrated.deck.cols).toBe(4);
    expect(migrated.controls).toEqual(old.controls);

    for (const value of [null, 'true', 1]) {
      expect(migrate({ ...old, display: { ...old.display, alwaysOnTop: value } }).display.alwaysOnTop).toBe(false);
    }
    for (const value of [false, true]) {
      const roundTrip = migrate({ ...old, display: { ...old.display, alwaysOnTop: value } });
      expect(roundTrip.display.alwaysOnTop).toBe(value);
      expect(migrate(roundTrip).display.alwaysOnTop).toBe(value);
    }
  });

  it('adds auto sizing to old decks and preserves valid manual sizes without mutating input', () => {
    const old = structuredClone(DEFAULTS);
    delete (old.deck as Partial<typeof old.deck>).sizing;
    old.deck.size = 96;
    const source = structuredClone(old);
    const auto = migrate(old);
    expect(auto.deck).toMatchObject({ sizing: 'auto', size: 96 });
    expect(migrate(auto)).toEqual(auto);
    expect(old).toEqual(source);

    const manual = migrate({ ...structuredClone(DEFAULTS), deck: { ...structuredClone(DEFAULTS.deck), sizing: 'manual', size: 88 } });
    expect(manual.deck).toMatchObject({ sizing: 'manual', size: 88 });
  });

  it('normalizes unknown sizing and malformed cell size', () => {
    const malformed = migrate({ ...structuredClone(DEFAULTS), deck: { ...structuredClone(DEFAULTS.deck), sizing: 'other', size: 0 } });
    expect(malformed.deck).toMatchObject({ sizing: 'auto', size: 112 });
    const nonFinite = migrate({ ...structuredClone(DEFAULTS), deck: { ...structuredClone(DEFAULTS.deck), size: Infinity } });
    expect(nonFinite.deck.size).toBe(112);
  });

  it('moves legacy colour to variants without overwriting explicit colours or empty labels', () => {
    const saved = structuredClone(DEFAULTS);
    (saved as { version: number }).version = 3;
    for (const control of saved.controls) delete control.scenario;
    saved.controls[0].color = '#123456';
    delete saved.controls[0].variants[0].color;
    saved.controls[0].variants[0].label = '';
    saved.controls[0].variants[1].color = '#abcdef80';
    saved.controls[0].variants[0].action = { id: 'media.prev', args: { source: 'system' } };
    saved.controls[0].variants[1].action = { id: 'media.prev', args: { source: 'spotify' } };
    saved.controls[0].gestures = { doubleTap: { variant: 1 } };
    delete saved.controls[1].gestures;
    const untouched = structuredClone(saved);
    const migrated = migrate(saved);
    expect(migrated.controls[0].color).toBeUndefined();
    expect(migrated.controls[0].variants[0]).toMatchObject({ label: '', color: '#123456' });
    expect(migrated.controls[0].variants[1].color).toBe('#abcdef80');
    expect(migrated.controls[0].gestures).toBeUndefined();
    expect(migrated.controls[0].scenario?.triggers.doubleTap?.steps[0]).toMatchObject({
      kind: 'action', action: { id: 'button.variant', args: { target: 'self', variant: 'state-2' } },
    });
    expect(migrated.controls[0].scenario?.triggers.press?.byState?.['state-1']?.[0]).toMatchObject({
      action: { id: 'media.prev', args: { source: 'system' } },
    });
    expect(migrated.controls[1].gestures).toBeUndefined();
    expect(migrated.controls[1].variants[0].color).toBe(DEFAULTS.controls[1].variants[0].color);
    expect(saved).toEqual(untouched);
    expect(migrate(migrated)).toEqual(migrated);
  });
});

import { describe, expect, it } from 'vitest';
import { serializeSettings } from './state.svelte';
import { DEFAULTS } from './defaults';
import { migrate } from './normalize';

describe('settings migration', () => {
  it.each([
    [],
    'settings',
    5,
    { version: 5, controls: {} },
    { version: 1, controls: [null] },
    { version: 2, controls: [{ id: 'x', type: 'button', variants: {} }] },
    { version: 2, deck: { cells: {} } },
    { version: 5, deck: { pages: {} } },
    { version: 5, display: [] },
    { version: 5, variants: { button: 'state' } },
    { version: 5, controls: [{ id: 'x', type: 'button', stateBinding: { cases: {} } }] },
  ])('rejects malformed settings without mutating the source: %j', (raw) => {
    const original = structuredClone(raw);
    expect(() => migrate(raw)).toThrow();
    expect(raw).toEqual(original);
  });

  it('upgrades v1 settings, keeping the user controls and mapping old icon names', () => {
    const v1 = {
      version: 1,
      skin: 'subway',
      display: { monitor: 'X', fullscreen: true },
      variants: { prev: 1 },
      controls: [
        {
          id: 'prev',
          type: 'button',
          variants: [
            {
              label: 'All',
              icon: 'prev',
              action: { id: 'media.prev', args: { target: 'spotify' } },
            },
          ],
        },
      ],
      slots: { 'bottom-strip': ['prev'], dock: ['prev'] },
    };
    const s = migrate(v1);
    expect(s.version).toBe(21);
    expect(s.deck.pages[0].applet).toBe('subway');
    expect(s.display).toMatchObject({
      monitor: 'X',
      fullscreen: true,
      background: { opacity: 0.55 },
    });
    expect(s.controls[0]).toMatchObject({
      id: 'prev',
      name: 'prev',
      variants: [{ id: 'state-1', icon: 'SkipBack' }],
      scenario: {
        triggers: {
          press: { steps: [{ kind: 'action', action: { args: { source: 'spotify' } } }] },
        },
      },
    });
    expect('slots' in s).toBe(false);
    expect(s.variants).toEqual({ prev: 1 });
  });

  it('turns v2 deck cells into positioned items and moves Spotify bits to the plugin', () => {
    const v2 = {
      version: 2,
      skin: 'deck',
      display: { monitor: null, fullscreen: false },
      variants: {},
      controls: [
        {
          id: 'sp',
          name: 'Spotify',
          type: 'button',
          variants: [{ label: 'Open', action: { id: 'open', args: { url: 'spotify:' } } }],
        },
      ],
      deck: { rows: 2, cols: 3, size: 100, gap: 10, cells: ['', 'sp', '', '', '', 'sp'] },
    };
    const s = migrate(v2);
    expect(s.deck.pages[0].items).toEqual([
      { id: 'i1', control: 'sp', x: 1, y: 0, w: 1, h: 1 },
      { id: 'i5', control: 'sp-2', x: 2, y: 1, w: 1, h: 1 },
    ]);
    expect(s.controls.map((c) => c.id)).toEqual(['sp', 'sp-2']);
    expect(s.controls[0].scenario?.triggers.press?.steps[0]).toMatchObject({
      kind: 'action',
      action: { id: 'open', args: { url: 'spotify:' } },
    });
  });

  it('uses defaults for missing data and refuses to overwrite a future settings version', () => {
    expect(migrate(undefined)).toEqual(DEFAULTS);
    expect(() => migrate({ version: DEFAULTS.version + 1 })).toThrow(
      'newer than this app supports',
    );
    expect(() => migrate({ version: 99 })).toThrow('newer than this app supports');
    expect(() => migrate({ version: '5', controls: [] })).toThrow('Unsupported settings version');
  });

  it('adds empty applet maps and round-trips Unicode configs and layouts without a second Deck source', () => {
    const old = structuredClone(DEFAULTS) as any;
    delete old.appletSettings;
    delete old.appletLayouts;
    expect(migrate(old)).toMatchObject({ appletSettings: {}, appletLayouts: {} });

    const saved = structuredClone(DEFAULTS) as any;
    saved.appletSettings.ghost = {
      shared: { label: '路線', future: { keep: true } },
      separate: true,
      perPage: { [saved.deck.pages[0].id]: { label: '個別' } },
    };
    saved.appletLayouts.ghost = {
      [saved.deck.pages[0].id]: {
        hidden: [
          { id: 'ghost-item', control: 'ghost-control', x: 8, y: 0, w: 1, h: 1, extra: 'keep' },
        ],
      },
    };
    saved.appletLayouts.deck = {
      [saved.deck.pages[0].id]: {
        main: [{ id: 'duplicate-deck', control: 'prev', x: 0, y: 0, w: 1, h: 1 }],
      },
    };
    const roundTrip = migrate(saved);
    expect(roundTrip.appletSettings.ghost).toEqual(saved.appletSettings.ghost);
    expect(roundTrip.appletLayouts.ghost[saved.deck.pages[0].id].hidden[0]).toMatchObject({
      id: 'ghost-item',
      x: 8,
      extra: 'keep',
    });
    expect(roundTrip.appletLayouts).not.toHaveProperty('deck');
    expect(roundTrip.deck.pages[0].items.map((item) => item.id)).toEqual(
      saved.deck.pages[0].items.map((item: any) => item.id),
    );
  });

  it('keeps structurally valid out-of-grid legacy placements and drops malformed coordinates', () => {
    const saved = structuredClone(DEFAULTS) as any;
    saved.deck.pages[0].items = [
      { id: 'outside', control: 'unavailable', x: 99, y: 0, w: 1, h: 1 },
      { id: 'negative', control: 'bad', x: -1, y: 0, w: 1, h: 1 },
      { id: 'fractional', control: 'bad', x: 0.5, y: 0, w: 1, h: 1 },
    ];
    saved.appletLayouts.unknown = {
      'page-1': {
        removed: [
          { id: 'retained', control: 'missing', x: 20, y: 0, w: 1, h: 1 },
          { id: 'invalid', control: 'missing', x: 0, y: 0, w: 0, h: 1 },
        ],
      },
    };
    const migrated = migrate(saved);
    expect(migrated.deck.pages[0].items.map((item: any) => item.id)).toEqual(['outside']);
    expect(migrated.appletLayouts.unknown['page-1'].removed.map((item: any) => item.id)).toEqual([
      'retained',
    ]);
  });

  it('gives cross-applet copies independent item and control IDs during normalization', () => {
    const saved = structuredClone(DEFAULTS) as any;
    saved.controls[0].options = { locale: '日本語' };
    saved.controls[0].scenario = {
      triggers: {
        press: {
          steps: [
            {
              id: 'kept-step',
              kind: 'action',
              action: { id: 'media.toggle', args: { source: 'system' } },
            },
          ],
        },
      },
      events: [],
    };
    saved.appletLayouts.subway = {
      [saved.deck.pages[0].id]: {
        strip: [{ id: 'applet-item', control: 'prev', x: 0, y: 0, w: 1, h: 1 }],
      },
    };
    const original = structuredClone(saved);
    const migrated = migrate(saved);
    const item = migrated.appletLayouts.subway['page-1'].strip[0];
    expect(item.id).toBe('applet-item');
    expect(item.control).not.toBe('prev');
    expect(migrated.controls.find((control) => control.id === item.control)).toMatchObject({
      options: { locale: '日本語' },
      scenario: { triggers: { press: { steps: [{ id: 'kept-step' }] } } },
    });
    expect(saved).toEqual(original);
  });

  it('keeps valid old display and page settings and defaults malformed ones', () => {
    const old = (display: object, page: object): any => {
      const defaults = structuredClone(DEFAULTS);
      return {
        ...defaults,
        version: 4,
        display: { ...defaults.display, ...display },
        deck: { ...defaults.deck.pages[0], ...page },
      };
    };
    const background = { color: '#123456', opacity: 0.3, radius: 42 };
    const valid = old(
      { monitor: 'DISPLAY-1', fullscreen: true, alwaysOnTop: true, background },
      { cols: 4, sizing: 'manual', size: 88 },
    );
    const source = structuredClone(valid);
    const migrated = migrate(valid);
    expect(migrated.display).toEqual({
      monitor: 'DISPLAY-1',
      monitorLabel: null,
      fullscreen: true,
      alwaysOnTop: true,
      iconScale: 1,
      labelScale: 1,
      background: { ...background, mode: 'color' },
    });
    expect(migrated.deck.pages[0]).toMatchObject({ cols: 4, sizing: 'manual', size: 88 });
    expect(migrate(migrated)).toEqual(migrated);
    expect(valid).toEqual(source);

    const modeOf = (mode: unknown) => migrate(old({ background: { mode } }, {})).display.background;
    expect([modeOf('wallpaper').mode, modeOf('video').mode]).toEqual(['wallpaper', 'color']);
    const scale = (display: object) =>
      migrate(old({ iconScale: undefined, ...display }, {})).display.iconScale;
    const cases = [{ iconSize: 'large' }, { iconScale: 1.3 }, { iconScale: 3 }];
    expect(cases.map(scale)).toEqual([1.5, 1.3, 1]);
    for (const alwaysOnTop of [undefined, null, 'true', 1]) {
      expect(migrate(old({ alwaysOnTop }, {})).display.alwaysOnTop).toBe(false);
    }
    for (const [sizing, size] of [
      ['other', 0],
      [undefined, Infinity],
    ]) {
      expect(migrate(old({}, { sizing, size })).deck.pages[0]).toMatchObject({
        sizing: 'auto',
        size: 112,
      });
    }
  });

  it('moves legacy colour to variants without overwriting explicit colours or empty labels', () => {
    const saved: any = structuredClone(DEFAULTS);
    saved.version = 3;
    saved.deck = { ...structuredClone(DEFAULTS.deck.pages[0]) };
    for (const control of saved.controls) delete control.scenario;
    saved.controls[0].color = '#123456';
    saved.controls[0].variants[1] = { ...saved.controls[0].variants[0], id: 'state-2' };
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
      kind: 'action',
      action: { id: 'button.variant', args: { target: 'self', variant: 'state-2' } },
    });
    expect(migrated.controls[0].scenario?.triggers.press?.byState?.['state-1']?.[0]).toMatchObject({
      action: { id: 'media.prev', args: { source: 'system' } },
    });
    expect(migrated.controls[1].gestures).toBeUndefined();
    expect(migrated.controls[1].variants[0].color).toBe(DEFAULTS.controls[1].variants[0].color);
    expect(saved).toEqual(untouched);
    expect(migrate(migrated)).toEqual(migrated);
  });

  it('normalizes stable page and item IDs across pages while keeping Unicode names and grid values', () => {
    const saved: any = structuredClone(DEFAULTS);
    saved.deck = {
      pages: [
        {
          ...structuredClone(DEFAULTS.deck.pages[0]),
          id: 'page-1',
          name: '台所',
          size: 301,
          items: [{ id: 'same-item', control: 'prev', x: 0, y: 0, w: 1, h: 1 }],
        },
        {
          ...structuredClone(DEFAULTS.deck.pages[0]),
          id: 'page-1',
          name: 'Desk',
          cols: 12,
          items: [{ id: 'same-item', control: 'prev', x: 1, y: 0, w: 1, h: 1 }],
        },
      ],
      activePage: 'missing',
    };
    saved.variants.prev = 1;
    const source = structuredClone(saved);
    const migrated = migrate(saved);
    expect(migrated.deck.pages.map((page) => [page.id, page.name, page.cols, page.size])).toEqual([
      ['page-1', '台所', 6, 301],
      ['page-2', 'Desk', 12, 112],
    ]);
    expect(migrated.deck.activePage).toBe('page-1');
    expect(migrated.deck.pages.map((page) => page.items[0].id)).toEqual(['same-item', 'item-1']);
    expect(migrated.deck.pages[1].items[0].control).toBe('prev-2');
    expect(migrated.variants['prev-2']).toBe(1);
    expect(saved).toEqual(source);
    expect(migrate(migrated)).toEqual(migrated);
  });

  it('drops legacy page rotation and serializes selection as the first page', () => {
    const malformed: any = {
      ...structuredClone(DEFAULTS),
      version: 5,
      deck: { pages: [], activePage: 'gone' },
      pageRotation: { intervalSeconds: 4 },
    };
    const migrated = migrate(malformed);
    expect(migrated.deck.pages).toHaveLength(1);
    expect(migrated.deck.activePage).toBe(migrated.deck.pages[0].id);
    expect(migrated).not.toHaveProperty('pageRotation');
    const selected = structuredClone(migrated);
    selected.deck.pages.push({
      ...structuredClone(selected.deck.pages[0]),
      id: 'other',
      name: 'Other',
    });
    selected.deck.activePage = 'other';
    const snapshot = serializeSettings(selected);
    expect(JSON.parse(snapshot).deck.activePage).toBe(selected.deck.pages[0].id);
    expect(JSON.parse(snapshot)).not.toHaveProperty('pageRotation');
    expect(selected.deck.activePage).toBe('other');
  });

  it('upgrades the short-lived v6 settings shape to v8 without losing values', () => {
    const interrupted: any = {
      ...structuredClone(DEFAULTS),
      version: 6,
      skin: 'subway',
      pageRotation: { intervalSeconds: 10 },
    };
    const migrated = migrate(interrupted);
    expect(migrated).toMatchObject({ version: 21, deck: { pages: [{ applet: 'subway' }] } });
    expect(migrated).not.toHaveProperty('pageRotation');
  });

  it('preserves media options through v5 migration and serialization', () => {
    const options = {
      sources: [{ kind: 'url', value: 'https://example.test/a.gif' }],
      fit: 'contain',
      interval: 12,
      loop: false,
      muted: false,
      futureOption: 'kept',
    };
    const saved = {
      ...structuredClone(DEFAULTS),
      controls: [
        {
          id: 'media-a',
          name: 'Gallery',
          type: 'media',
          variants: [{ id: 'state-1', label: '' }],
          options,
        },
      ],
      deck: {
        pages: [
          {
            ...structuredClone(DEFAULTS.deck.pages[0]),
            items: [{ id: 'media-item', control: 'media-a', x: 0, y: 0, w: 2, h: 2 }],
          },
        ],
        activePage: 'page-1',
      },
    };
    const migrated = migrate(saved);
    expect(migrated.controls[0].options).toEqual(options);
    expect(JSON.parse(serializeSettings(migrated)).controls[0].options).toEqual(options);
  });
});

const v7Layout = {
  subway: {
    'page-1': { strip: [{ id: 'sw-1', control: 'ghost-a', x: 0, y: 0, w: 1, h: 1 }] },
    'page-2': { strip: [{ id: 'sw-2', control: 'ghost-b', x: 1, y: 0, w: 2, h: 1 }] },
  },
};
const v7Settings = {
  subway: { line: 'yamanote', gesture: 'cornerHold', future: { keep: '保持' } },
};

function v7File(skin: unknown, extra: object = {}) {
  const file = structuredClone(DEFAULTS) as any;
  delete file.appletSettings;
  delete file.appletLayouts;
  file.deck.pages = [
    { ...file.deck.pages[0], id: 'page-1' },
    { ...file.deck.pages[0], id: 'page-2', name: 'Page 2', items: [] },
  ];
  file.deck.activePage = 'page-1';
  return {
    ...file,
    version: 7,
    skin,
    skinSettings: structuredClone(v7Settings),
    skinLayouts: structuredClone(v7Layout),
    ...extra,
  };
}

describe('settings v7 to v8', () => {
  it.each([
    ['subway', 'subway', ['subway', 'subway']],
    ['an unknown id, so a disabled plugin loses nothing', 'mystery', ['mystery', 'mystery']],
    ['deck', 'deck', [undefined, undefined]],
  ])(
    'moves skin %s to the pages and the settings and layouts to the applet keys',
    (_, skin, applets) => {
      const migrated = migrate(v7File(skin));
      expect(migrated.version).toBe(21);
      expect(migrated).not.toHaveProperty('skin');
      expect(migrated).not.toHaveProperty('skinSettings');
      expect(migrated).not.toHaveProperty('skinLayouts');
      expect(migrated.deck.pages.map((page) => page.applet)).toEqual(applets);
      if (!applets[0]) {
        expect(migrated.deck.pages.every((page) => !('applet' in page))).toBe(true);
      }
      expect(migrated.appletSettings).toEqual({
        subway: { shared: v7Settings.subway, separate: false },
      });
      expect(migrated.appletLayouts).toEqual(v7Layout);
    },
  );

  it('round-trips a v8 file unchanged', () => {
    const once = migrate(v7File('subway'));
    expect(migrate(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it.each([
    ['a skin that is not text', { skin: 5 }],
    ['applet settings that are not an object', { skinSettings: [] }],
    ['applet layouts that are not an object', { skinLayouts: 'x' }],
  ])('refuses %s instead of dropping it', (_, patch) => {
    const file = v7File('deck', patch);
    const original = structuredClone(file);
    expect(() => migrate(file)).toThrow();
    expect(file).toEqual(original);
  });

  it('drops invalid page applet ids but keeps the page', () => {
    const file = migrate(v7File('subway')) as any;
    file.deck.pages[0].applet = '';
    file.deck.pages[1].applet = 'x'.repeat(129);
    expect(migrate(file).deck.pages.map((page) => 'applet' in page)).toEqual([false, false]);
  });
});

describe('settings v9 to v10', () => {
  it('moves the Subway side controls into free strip cells instead of losing them', () => {
    const file = structuredClone(DEFAULTS) as any;
    const strip = [0, 1, 3, 4, 5, 6, 7].map((x) => ({
      id: `strip-${x}`,
      control: `strip-control-${x}`,
      x,
      y: 0,
      w: 1,
      h: 1,
    }));
    file.version = 9;
    file.appletLayouts = {
      subway: {
        'page-1': {
          strip,
          side: [
            { id: 'side-1', control: 'side-control-1', x: 0, y: 0, w: 1, h: 2 },
            { id: 'side-2', control: 'side-control-2', x: 0, y: 1, w: 1, h: 1 },
          ],
        },
      },
    };
    const migrated = migrate(file);
    expect(migrated.version).toBe(21);
    expect(migrated.appletLayouts.subway['page-1']).toEqual({
      strip: [
        ...strip,
        { id: 'side-1', control: 'side-control-1', x: 2, y: 0, w: 1, h: 1 },
        { id: 'side-2', control: 'side-control-2', x: 8, y: 0, w: 1, h: 1 },
      ],
    });
  });
});

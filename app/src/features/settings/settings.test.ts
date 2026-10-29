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
    expect(s.version).toBe(7);
    expect(s.skin).toBe('subway');
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
      action: { id: 'spotify.open' },
    });
  });

  it('uses defaults for missing data and refuses to overwrite a future settings version', () => {
    expect(migrate(undefined)).toEqual(DEFAULTS);
    expect(() => migrate({ version: 8 })).toThrow('newer than this app supports');
    expect(() => migrate({ version: 99 })).toThrow('newer than this app supports');
    expect(() => migrate({ version: '5', controls: [] })).toThrow('Unsupported settings version');
  });

  it('adds empty skin maps and round-trips Unicode configs and layouts without a second Deck source', () => {
    const old = structuredClone(DEFAULTS) as any;
    delete old.skinSettings;
    delete old.skinLayouts;
    expect(migrate(old)).toMatchObject({ skinSettings: {}, skinLayouts: {} });

    const saved = structuredClone(DEFAULTS) as any;
    saved.skinSettings.ghost = { label: '路線', future: { keep: true } };
    saved.skinLayouts.ghost = {
      [saved.deck.pages[0].id]: {
        hidden: [
          { id: 'ghost-item', control: 'ghost-control', x: 8, y: 0, w: 1, h: 1, extra: 'keep' },
        ],
      },
    };
    saved.skinLayouts.deck = {
      [saved.deck.pages[0].id]: {
        main: [{ id: 'duplicate-deck', control: 'prev', x: 0, y: 0, w: 1, h: 1 }],
      },
    };
    const roundTrip = migrate(saved);
    expect(roundTrip.skinSettings.ghost).toEqual({ label: '路線', future: { keep: true } });
    expect(roundTrip.skinLayouts.ghost[saved.deck.pages[0].id].hidden[0]).toMatchObject({
      id: 'ghost-item',
      x: 8,
      extra: 'keep',
    });
    expect(roundTrip.skinLayouts).not.toHaveProperty('deck');
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
    saved.skinLayouts.unknown = {
      'page-1': {
        removed: [
          { id: 'retained', control: 'missing', x: 20, y: 0, w: 1, h: 1 },
          { id: 'invalid', control: 'missing', x: 0, y: 0, w: 0, h: 1 },
        ],
      },
    };
    const migrated = migrate(saved);
    expect(migrated.deck.pages[0].items.map((item: any) => item.id)).toEqual(['outside']);
    expect(migrated.skinLayouts.unknown['page-1'].removed.map((item: any) => item.id)).toEqual([
      'retained',
    ]);
  });

  it('gives cross-skin copies independent item and control IDs during normalization', () => {
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
    saved.skinLayouts.subway = {
      [saved.deck.pages[0].id]: {
        strip: [{ id: 'skin-item', control: 'prev', x: 0, y: 0, w: 1, h: 1 }],
      },
    };
    const original = structuredClone(saved);
    const migrated = migrate(saved);
    const item = migrated.skinLayouts.subway['page-1'].strip[0];
    expect(item.id).toBe('skin-item');
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
      {
        cols: 4,
        sizing: 'manual',
        size: 88,
      },
    );
    const source = structuredClone(valid);
    const migrated = migrate(valid);
    expect(migrated.display).toEqual({
      monitor: 'DISPLAY-1',
      fullscreen: true,
      alwaysOnTop: true,
      background,
    });
    expect(migrated.deck.pages[0]).toMatchObject({ cols: 4, sizing: 'manual', size: 88 });
    expect(migrate(migrated)).toEqual(migrated);
    expect(valid).toEqual(source);

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

  it('upgrades the short-lived v6 settings shape to v7 without losing values', () => {
    const interrupted: any = {
      ...structuredClone(DEFAULTS),
      version: 6,
      skin: 'subway',
      pageRotation: { intervalSeconds: 10 },
    };
    const migrated = migrate(interrupted);
    expect(migrated).toMatchObject({ version: 7, skin: 'subway' });
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

describe('now playing options', () => {
  const withWidget = (version: number, options?: unknown) => {
    const saved: any = { ...structuredClone(DEFAULTS), version };
    saved.controls.push({
      id: 'np',
      name: 'Now playing',
      type: 'nowPlaying',
      variants: [{ id: 'state-1', label: '' }],
      ...(options === undefined ? {} : { options }),
    });
    return saved;
  };
  const widget = (settings: ReturnType<typeof migrate>) =>
    settings.controls.find((control) => control.id === 'np');

  it('upgrades v6 to v7 keeping every setting and giving the widget the All filter', () => {
    const v6 = withWidget(6);
    const migrated = migrate(v6);
    expect(migrated.version).toBe(7);
    expect(widget(migrated)?.options).toEqual({ sources: [] });
    expect({ ...migrated, version: 6, controls: migrated.controls.slice(0, -1) }).toEqual({
      ...v6,
      controls: v6.controls.slice(0, -1),
    });
    expect(migrate(JSON.parse(serializeSettings(migrated)))).toEqual(migrated);
  });

  it('keeps an explicit filter, including sources of apps that are not running', () => {
    const sources = ['spotify', 'app:Gone.App!Main'];
    const migrated = migrate(withWidget(7, { sources: [...sources, 'spotify'] }));
    expect(widget(migrated)?.options).toEqual({ sources });
  });

  it.each([{ sources: 'spotify' }, { sources: [1] }, { sources: [''] }, { sources: [null] }])(
    'refuses a malformed filter instead of widening it to All: %j',
    (options) => {
      expect(() => migrate(withWidget(7, options))).toThrow('Now playing sources are malformed');
    },
  );
});

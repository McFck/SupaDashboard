import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './defaults';
import { migrate } from './normalize';

describe('settings v23 linked widgets', () => {
  it('preserves shared control IDs across deck pages, applet slots, and the same page', () => {
    const saved = structuredClone(DEFAULTS);
    saved.deck.pages = [
      {
        ...structuredClone(DEFAULTS.deck.pages[0]),
        id: 'page-1',
        items: [
          { id: 'i1', control: 'prev', x: 0, y: 0, w: 1, h: 1 },
          { id: 'i2', control: 'prev', x: 1, y: 0, w: 1, h: 1 },
        ],
      },
      {
        ...structuredClone(DEFAULTS.deck.pages[0]),
        id: 'page-2',
        name: 'Page 2',
        items: [{ id: 'i3', control: 'prev', x: 0, y: 0, w: 1, h: 1 }],
      },
    ];
    saved.appletLayouts.subway = {
      'page-1': {
        strip: [{ id: 'i4', control: 'prev', x: 0, y: 0, w: 1, h: 1 }],
      },
    };
    saved.variants.prev = 1;

    const loaded = migrate(saved);
    expect(loaded.version).toBe(24);
    expect(loaded.deck.pages[0].items.map((item) => item.control)).toEqual(['prev', 'prev']);
    expect(loaded.deck.pages[1].items.map((item) => item.control)).toEqual(['prev']);
    expect(loaded.appletLayouts.subway['page-1'].strip[0].control).toBe('prev');
    expect(loaded.controls.filter((control) => control.id === 'prev')).toHaveLength(1);
    expect(loaded.variants).toEqual({ prev: 1 });
  });

  it('splits pre-v23 cross-applet shared controls during upgrade', () => {
    const saved = structuredClone(DEFAULTS) as any;
    saved.version = 22;
    saved.controls[0].options = { locale: '日本語' };
    saved.appletLayouts.subway = {
      [saved.deck.pages[0].id]: {
        strip: [{ id: 'applet-item', control: 'prev', x: 0, y: 0, w: 1, h: 1 }],
      },
    };
    const migrated = migrate(saved);
    const item = migrated.appletLayouts.subway['page-1'].strip[0];
    expect(item.id).toBe('applet-item');
    expect(item.control).not.toBe('prev');
    expect(migrated.controls.find((control) => control.id === item.control)).toMatchObject({
      options: { locale: '日本語' },
    });
  });
});

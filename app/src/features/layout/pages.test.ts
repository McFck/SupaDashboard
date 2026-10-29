import { describe, expect, it } from 'vitest';
import type { ControlConfig } from '../controls/model';
import { type Settings } from '../settings/schema';
import { DEFAULTS } from '../settings/defaults';
import {
  addPage,
  deletePage,
  duplicatePage,
  pageAfterRemoval,
  renamePage,
  reorderPage,
} from './pages';
import { pageItems } from './placements';

const control = (id: string, target = 'self'): ControlConfig => ({
  id,
  name: id,
  type: 'button',
  variants: [
    { id: 'state-a', label: 'A' },
    { id: 'state-b', label: 'B' },
  ],
  scenario: {
    triggers: {
      press: {
        steps: [
          {
            id: 'step-a',
            kind: 'action',
            action: { id: 'button.variant', args: { target, variant: 'state-b' } },
          },
        ],
      },
    },
    events: [],
  },
});
const page = (id: string, cols = 4, items: PageItem[] = [], name = id) => ({
  ...structuredClone(DEFAULTS.deck.pages[0]),
  id,
  name,
  cols,
  items,
});
type PageItem = { id: string; control: string; x: number; y: number; w: number; h: number };

const first = page('page-a', 4, [{ id: 'item-a', control: 'shared', x: 0, y: 0, w: 1, h: 1 }]);
const second = page('page-b', 4, [
  { id: 'item-b', control: 'shared', x: 0, y: 0, w: 1, h: 1 },
  { id: 'item-c', control: 'other', x: 1, y: 0, w: 1, h: 1 },
]);

describe('page helpers', () => {
  it('adds blank pages with selected geometry and the next unused display name', () => {
    const custom = { ...first, name: 'Page 1', rows: 9, cols: 7, gap: 20, items: [] };
    const existing = { ...second, name: 'Page 2' };
    const added = addPage([custom, existing], [], custom.id)!;
    expect(added.page).toMatchObject({ name: 'Page 3', rows: 9, cols: 7, gap: 20, items: [] });
    expect(added.page.id).toMatch(/^page-/);
    expect(added.pages.map((p) => p.id)).toEqual([custom.id, existing.id, added.page.id]);
  });

  it('trims rename values, allows duplicate names, and reorders without changing stable IDs', () => {
    const renamed = renamePage([first, second], first.id, '  屏幕一  ')!;
    expect(renamed.pages[0].name).toBe('屏幕一');
    expect(renamePage(renamed.pages, first.id, '  ')).toBeUndefined();
    const sameName = renamePage(renamed.pages, second.id, '屏幕一')!;
    const reordered = reorderPage(sameName.pages, first.id, 1)!;
    expect(reordered.pages.map((p) => [p.id, p.name])).toEqual([
      ['page-b', '屏幕一'],
      ['page-a', '屏幕一'],
    ]);
    expect(reorderPage(reordered.pages, 'missing', 0)).toBeUndefined();
  });

  it('keeps applet layouts attached to stable page IDs across rename and reorder', () => {
    const layouts = {
      subway: {
        [first.id]: {
          strip: [{ id: 'first-applet-item', control: 'applet-a', x: 0, y: 0, w: 1, h: 1 }],
        },
        [second.id]: {
          strip: [{ id: 'second-applet-item', control: 'applet-b', x: 1, y: 0, w: 1, h: 1 }],
        },
      },
    };
    const renamed = renamePage([first, second], first.id, 'Kitchen')!;
    const reordered = reorderPage(renamed.pages, first.id, 1)!;
    expect(reordered.pages.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(layouts.subway[first.id].strip[0].id).toBe('first-applet-item');
    expect(layouts.subway[second.id].strip[0].id).toBe('second-applet-item');
  });

  it('deep-copies a populated page with globally new IDs while preserving local and explicit references', () => {
    const self = control('button');
    const explicit = control('other', 'external-control');
    const source = page(
      'page-source',
      4,
      [
        { id: 'item-one', control: self.id, x: 0, y: 0, w: 1, h: 1 },
        { id: 'item-two', control: explicit.id, x: 1, y: 0, w: 1, h: 1 },
      ],
      'Studio',
    );
    const copied = duplicatePage([source], source.id, [self, explicit], { [self.id]: 1 })!;
    const clone = copied.page.items.map((item) =>
      copied.controls.find((entry) => entry.id === item.control)!,
    );
    expect(copied.page).toMatchObject({
      name: 'Studio copy',
      rows: source.rows,
      cols: source.cols,
      gap: source.gap,
    });
    expect(copied.page.id).not.toBe(source.id);
    expect(copied.page.items.map((item) => item.id)).not.toEqual(
      source.items.map((item) => item.id),
    );
    expect(clone.map((entry) => entry.id)).not.toContain(self.id);
    expect(
      new Set([
        ...copied.pages.map((p) => p.id),
        ...copied.pages.flatMap((p) => p.items.map((i) => i.id)),
        ...copied.controls.map((c) => c.id),
      ]).size,
    ).toBe(
      copied.pages.length +
        copied.pages.reduce((n, p) => n + p.items.length, 0) +
        copied.controls.length,
    );
    expect(clone[0].scenario?.triggers.press?.steps[0]).toMatchObject({
      action: { args: { target: 'self', variant: 'state-b' } },
    });
    expect(clone[1].scenario?.triggers.press?.steps[0]).toMatchObject({
      action: { args: { target: 'external-control' } },
    });
    expect(clone[0].variants.map((v) => v.id)).toEqual(['state-a', 'state-b']);
    expect(copied.variants).toEqual({ button: 1 });
    clone[0].variants[0].label = 'Changed copy';
    expect(self.variants[0].label).toBe('A');
    expect(copied.controls.some((entry) => entry.id === 'external-control')).toBe(false);
    expect(duplicatePage([source], source.id, [], {})).toBeUndefined();
  });

  it('duplicates and deletes per-applet layouts by stable page ID with independent controls and items', () => {
    const source = page('page-layout-source', 4, [
      { id: 'deck-owned', control: 'deck-control', x: 0, y: 0, w: 1, h: 1 },
    ]);
    const controls = [
      control('deck-control'),
      control('applet-control'),
      control('retained-control'),
    ];
    const layouts: Settings['appletLayouts'] = {
      subway: {
        [source.id]: {
          strip: [{ id: 'applet-owned', control: 'applet-control', x: 0, y: 0, w: 1, h: 1 }],
        },
        'page-other': {
          hidden: [{ id: 'other-layout', control: 'retained-control', x: 0, y: 0, w: 1, h: 1 }],
        },
      },
      unavailable: { [source.id]: { removed: [] } },
    };
    const copied = duplicatePage([source, page('page-other')], source.id, controls, {}, layouts)!;
    const copiedItems = copied.appletLayouts.subway[copied.page.id].strip;
    expect(copiedItems).toHaveLength(1);
    expect(copiedItems[0].id).not.toBe('applet-owned');
    expect(copiedItems[0].control).not.toBe('applet-control');
    expect(copied.appletLayouts.unavailable?.[copied.page.id]?.removed).toEqual([]);
    expect(layouts.subway[source.id].strip[0]).toEqual({
      id: 'applet-owned',
      control: 'applet-control',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
    expect(pageItems(copied.pages, copied.appletLayouts).map((item) => item.id)).toContain(
      copiedItems[0].id,
    );

    const deleted = deletePage(
      copied.pages,
      source.id,
      copied.controls,
      copied.variants,
      copied.appletLayouts,
    )!;
    expect(deleted.appletLayouts.subway).not.toHaveProperty(source.id);
    expect(deleted.appletLayouts.subway).toHaveProperty('page-other');
    expect(deleted.controls.some((entry) => entry.id === 'retained-control')).toBe(true);
  });

  it('deletes only unused controls and their variants, preserves controls referenced by other pages', () => {
    const pages = [first, second, page('page-c', 4, [])];
    const deleted = deletePage(
      pages,
      'page-a',
      [control('shared'), control('other'), control('unused')],
      { shared: 1, other: 0, unused: 1 },
    )!;
    expect(deleted.pages.map((p) => p.id)).toEqual(['page-b', 'page-c']);
    expect(deleted.controls.map((c) => c.id)).toEqual(['shared', 'other']);
    expect(deleted.variants).toEqual({ shared: 1, other: 0 });
    expect(deletePage([first], first.id, [], {})).toBeUndefined();
    expect(deletePage(pages, 'missing', [], {})).toBeUndefined();
  });

  it('chooses the page now at the deleted page index, then clamps to the predecessor', () => {
    expect(pageAfterRemoval([first, second], 'gone', ['page-a', 'gone', 'page-b'])).toBe('page-b');
    expect(pageAfterRemoval([first], 'gone', ['page-a', 'gone'])).toBe('page-a');
    expect(pageAfterRemoval([], 'gone', ['gone'])).toBeUndefined();
  });
});

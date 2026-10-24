import { describe, expect, it } from 'vitest';
import type { ControlConfig } from './controls';
import { DEFAULTS } from './settings.svelte';
import { addPage, deletePage, duplicatePage, hasPlacement, MAX_PAGES, movePlacement, pageAfterRemoval, pageById, pageItems,
  placementById, removePlacement, renamePage, reorderPage } from './pages';

const control = (id: string, target = 'self'): ControlConfig => ({
  id, name: id, type: 'button', variants: [{ id: 'state-a', label: 'A' }, { id: 'state-b', label: 'B' }],
  scenario: { triggers: { press: { steps: [{ id: 'step-a', kind: 'action', action: { id: 'button.variant', args: { target, variant: 'state-b' } } }] } }, events: [] },
});
const page = (id: string, cols = 4, items: PageItem[] = [], name = id) => ({
  ...structuredClone(DEFAULTS.deck.pages[0]), id, name, cols, items,
});
type PageItem = { id: string; control: string; x: number; y: number; w: number; h: number };

const first = page('page-a', 4, [{ id: 'item-a', control: 'shared', x: 0, y: 0, w: 1, h: 1 }]);
const second = page('page-b', 4, [
  { id: 'item-b', control: 'shared', x: 0, y: 0, w: 1, h: 1 },
  { id: 'item-c', control: 'other', x: 1, y: 0, w: 1, h: 1 },
]);

describe('page helpers', () => {
  it('resolves IDs and flattens placements across pages without merging page geometry', () => {
    const pages = [first, second];
    expect(pageById(pages, 'page-b')).toBe(second);
    expect(pageById(pages, 'missing')).toBe(first);
    expect(pageItems(pages).map(item => item.id)).toEqual(['item-a', 'item-b', 'item-c']);
    expect(placementById(pages, 'item-c')).toMatchObject({ page: second, item: { control: 'other' } });
    expect(placementById(pages, 'missing')).toBeUndefined();
    expect(hasPlacement(pages, 'shared')).toBe(true);
  });

  it('adds blank pages with selected geometry and the next unused display name', () => {
    const custom = { ...first, name: 'Page 1', rows: 9, cols: 7, gap: 20, items: [] };
    const existing = { ...second, name: 'Page 2' };
    const added = addPage([custom, existing], [], custom.id)!;
    expect(added.page).toMatchObject({ name: 'Page 3', rows: 9, cols: 7, gap: 20, items: [] });
    expect(added.page.id).toMatch(/^page-/);
    expect(added.pages.map(p => p.id)).toEqual([custom.id, existing.id, added.page.id]);
  });

  it('limits add and duplicate to ten pages', () => {
    const pages = Array.from({ length: MAX_PAGES }, (_, index) => page(`limit-${index}`));
    expect(addPage(pages.slice(0, -1), [], pages[0].id)?.pages).toHaveLength(MAX_PAGES);
    expect(duplicatePage(pages.slice(0, -1), pages[0].id, [], {})?.pages).toHaveLength(MAX_PAGES);
    expect(addPage(pages, [], pages[0].id)).toBeUndefined();
    expect(duplicatePage(pages, pages[0].id, [], {})).toBeUndefined();
  });

  it('trims rename values, allows duplicate names, and reorders without changing stable IDs', () => {
    const renamed = renamePage([first, second], first.id, '  屏幕一  ')!;
    expect(renamed.pages[0].name).toBe('屏幕一');
    expect(renamePage(renamed.pages, first.id, '  ')).toBeUndefined();
    const sameName = renamePage(renamed.pages, second.id, '屏幕一')!;
    const reordered = reorderPage(sameName.pages, first.id, 1)!;
    expect(reordered.pages.map(p => [p.id, p.name])).toEqual([['page-b', '屏幕一'], ['page-a', '屏幕一']]);
    expect(reorderPage(reordered.pages, 'missing', 0)).toBeUndefined();
  });

  it('deep-copies a populated page with globally new IDs while preserving local and explicit references', () => {
    const self = control('button');
    const explicit = control('other', 'external-control');
    const source = page('page-source', 4, [
      { id: 'item-one', control: self.id, x: 0, y: 0, w: 1, h: 1 },
      { id: 'item-two', control: explicit.id, x: 1, y: 0, w: 1, h: 1 },
    ], 'Studio');
    const copied = duplicatePage([source], source.id, [self, explicit], { [self.id]: 1 })!;
    const clone = copied.page.items.map(item => copied.controls.find(entry => entry.id === item.control)!);
    expect(copied.page).toMatchObject({ name: 'Studio copy', rows: source.rows, cols: source.cols, gap: source.gap });
    expect(copied.page.id).not.toBe(source.id);
    expect(copied.page.items.map(item => item.id)).not.toEqual(source.items.map(item => item.id));
    expect(clone.map(entry => entry.id)).not.toContain(self.id);
    expect(new Set([...copied.pages.map(p => p.id), ...copied.pages.flatMap(p => p.items.map(i => i.id)), ...copied.controls.map(c => c.id)]).size)
      .toBe(copied.pages.length + copied.pages.reduce((n, p) => n + p.items.length, 0) + copied.controls.length);
    expect(clone[0].scenario?.triggers.press?.steps[0]).toMatchObject({ action: { args: { target: 'self', variant: 'state-b' } } });
    expect(clone[1].scenario?.triggers.press?.steps[0]).toMatchObject({ action: { args: { target: 'external-control' } } });
    expect(clone[0].variants.map(v => v.id)).toEqual(['state-a', 'state-b']);
    expect(copied.variants).toEqual({ button: 1 });
    clone[0].variants[0].label = 'Changed copy';
    expect(self.variants[0].label).toBe('A');
    expect(copied.controls.some(entry => entry.id === 'external-control')).toBe(false);
    expect(duplicatePage([source], source.id, [], {})).toBeUndefined();
  });

  it('deletes only unused controls and their variants, preserves controls referenced by other pages', () => {
    const pages = [first, second, page('page-c', 4, [])];
    const deleted = deletePage(pages, 'page-a', [control('shared'), control('other'), control('unused')],
      { shared: 1, other: 0, unused: 1 })!;
    expect(deleted.pages.map(p => p.id)).toEqual(['page-b', 'page-c']);
    expect(deleted.controls.map(c => c.id)).toEqual(['shared', 'other']);
    expect(deleted.variants).toEqual({ shared: 1, other: 0 });
    expect(deletePage([first], first.id, [], {})).toBeUndefined();
    expect(deletePage(pages, 'missing', [], {})).toBeUndefined();
  });

  it('moves a placement with exact IDs and footprint, preserving its preferred cell or using firstFree', () => {
    const source = page('source', 4, [{ id: 'move-me', control: 'control-me', x: 2, y: 1, w: 2, h: 1 }]);
    const clear = page('clear', 4);
    const preferred = movePlacement([source, clear], source.id, clear.id, 'move-me')!;
    expect(preferred.item).toEqual(source.items[0]);
    expect(preferred.pages[0].items).toEqual([]);
    expect(preferred.pages[1].items[0]).toEqual(source.items[0]);
    const blocked = page('blocked', 4, [{ id: 'blocker', control: 'blocker', x: 2, y: 1, w: 2, h: 1 }]);
    const relocated = movePlacement([source, blocked], source.id, blocked.id, 'move-me')!;
    expect(relocated.item).toMatchObject({ id: 'move-me', control: 'control-me', x: 0, y: 0, w: 2, h: 1 });
  });

  it('leaves both pages unchanged when the exact moved footprint cannot fit', () => {
    const source = page('source', 4, [{ id: 'move-me', control: 'control-me', x: 0, y: 0, w: 2, h: 2 }]);
    const small = page('small', 1);
    const full = page('full', 2, [{ id: 'blocker', control: 'blocker', x: 0, y: 0, w: 2, h: 2 }]);
    for (const destination of [small, full]) {
      const before = structuredClone([source, destination]);
      expect(movePlacement([source, destination], source.id, destination.id, 'move-me')).toBeUndefined();
      expect([source, destination]).toEqual(before);
    }
  });

  it('removes only the requested placement and marks a control orphan after its last use', () => {
    const pages = [first, second];
    const one = removePlacement(pages, 'page-a', 'item-a');
    expect(one.item?.control).toBe('shared');
    expect(one.orphanControl).toBeUndefined();
    expect(one.pages[0].items).toEqual([]);
    expect(second.items).toHaveLength(2);
    const last = removePlacement(one.pages, 'page-b', 'item-b');
    expect(last.orphanControl).toBe('shared');
    expect(last.pages[1].items.map(item => item.id)).toEqual(['item-c']);
    expect(removePlacement(last.pages, 'page-b', 'missing').item).toBeUndefined();
  });

  it('chooses the page now at the deleted page index, then clamps to the predecessor', () => {
    expect(pageAfterRemoval([first, second], 'gone', ['page-a', 'gone', 'page-b'])).toBe('page-b');
    expect(pageAfterRemoval([first], 'gone', ['page-a', 'gone'])).toBe('page-a');
    expect(pageAfterRemoval([], 'gone', ['gone'])).toBeUndefined();
  });
});

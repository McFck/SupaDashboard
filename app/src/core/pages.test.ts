import { describe, expect, it } from 'vitest';
import { pageAfterRemoval, pageById, pageItems, placementById, hasPlacement, removePlacement } from './pages';
import { DEFAULTS } from './settings.svelte';

const first = { ...structuredClone(DEFAULTS.deck.pages[0]), id: 'page-a', items: [
  { id: 'item-a', control: 'shared', x: 0, y: 0, w: 1, h: 1 },
] };
const second = { ...structuredClone(DEFAULTS.deck.pages[0]), id: 'page-b', items: [
  { id: 'item-b', control: 'shared', x: 0, y: 0, w: 1, h: 1 },
  { id: 'item-c', control: 'other', x: 1, y: 0, w: 1, h: 1 },
] };

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

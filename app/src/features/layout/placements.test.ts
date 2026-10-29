import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../settings/defaults';
import { hasPlacement, pageItems, removePlacement, storedPlacements } from './placements';

type PageItem = { id: string; control: string; x: number; y: number; w: number; h: number };
const item = (id: string, control: string): PageItem => ({ id, control, x: 0, y: 0, w: 1, h: 1 });
const page = (id: string, items: PageItem[]) => ({
  ...structuredClone(DEFAULTS.deck.pages[0]),
  id,
  name: id,
  items,
});
const first = page('page-a', [item('item-a', 'shared')]);
const second = page('page-b', [item('item-b', 'shared'), { ...item('item-c', 'other'), x: 1 }]);

describe('stored placements', () => {
  it('lists deck and applet placements, ignoring a stale deck alias', () => {
    const pages = [first, second];
    const layouts = {
      subway: { [second.id]: { strip: [item('applet-item', 'shared')] } },
      deck: { [second.id]: { main: [item('duplicate-deck', 'shared')] } },
    };
    expect(pageItems(pages, layouts).map((entry) => entry.id)).toEqual([
      'item-a',
      'item-b',
      'item-c',
      'applet-item',
    ]);
    expect(hasPlacement({ deck: { pages }, skinLayouts: layouts }, 'shared')).toBe(true);
  });

  it('keeps placements of unknown applets and slots, so their controls still count as used', () => {
    const source = {
      deck: { pages: [] },
      skinLayouts: { unavailable: { 'old-page': { removed: [item('retained', 'kept')] } } },
    };
    expect(storedPlacements(source)).toContainEqual(
      expect.objectContaining({ appletId: 'unavailable', pageId: 'old-page', slotId: 'removed' }),
    );
    expect(hasPlacement(source, 'kept')).toBe(true);
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
    expect(last.pages[1].items.map((entry) => entry.id)).toEqual(['item-c']);
    expect(removePlacement(last.pages, 'page-b', 'missing').item).toBeUndefined();
  });
});

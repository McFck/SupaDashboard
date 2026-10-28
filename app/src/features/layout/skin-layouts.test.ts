import { afterEach, describe, expect, it } from 'vitest';
import { controlTypes, skins } from '../plugins/registry';
import { DEFAULTS } from '../settings/schema';
import {
  canSetLayoutItems,
  layoutFor,
  movePlacementToSlot,
  placementById,
  setLayoutItems,
  validSlotItems,
  effectiveSize,
} from './skin-layouts';
import { storedPlacements } from './placements';
import type { SkinDef } from '../skins/contracts';

const skinId = 'r5-layout-test';
const typeId = 'r5-layout-button';
const otherTypeId = 'r5-layout-other';
const deckTypeId = 'r5-deck-button';
const skin: SkinDef = {
  id: skinId,
  title: 'Test',
  component: {} as any,
  design: { width: 100, height: 100 },
  slots: [
    {
      id: 'main',
      style: 'region',
      kind: 'grid',
      accepts: [typeId],
      max: 2,
      size: { w: 1, h: 1 },
      grid: { rows: 1, cols: 2, size: 40, gap: 4, sizing: 'auto' },
    },
  ],
  views: [{ id: 'default', title: 'Default', slots: ['main'] }],
  defaultView: 'default',
};
const item = (id: string, control: string, x: number) => ({ id, control, x, y: 0, w: 1, h: 1 });

afterEach(() => {
  skins.delete(skinId);
  controlTypes.delete(typeId);
  controlTypes.delete(otherTypeId);
  controlTypes.delete(deckTypeId);
});

describe('skin layout storage', () => {
  it('aliases Deck main to page items and reads non-Deck layouts without creating entries', () => {
    const source = structuredClone(DEFAULTS);
    const deckItems = [item('deck-item', 'deck-control', 0)];
    controlTypes.set(deckTypeId, {
      type: deckTypeId,
      title: 'Button',
      icon: 'Square',
      component: {} as any,
      size: { w: 1, h: 1 },
      create: () => ({ name: 'Button', variants: [] }),
    } as any);
    source.controls = [{ id: 'deck-control', name: 'Deck', type: deckTypeId, variants: [] }] as any;
    source.skinLayouts.deck = { 'page-1': { main: [item('ignored-alias', 'deck-control', 1)] } };
    expect(
      setLayoutItems(source, { skinId: 'deck', pageId: 'page-1', slotId: 'main' }, deckItems),
    ).toBe(true);
    expect(layoutFor(source, 'deck', source.deck.pages[0].id, 'main')?.items).toBe(deckItems);
    expect(source.deck.pages[0].items).toBe(deckItems);
    expect(source.skinLayouts).toEqual({});
    source.skinLayouts.deck = { 'page-1': { main: [item('duplicate-alias', 'other-control', 1)] } };
    expect(
      storedPlacements(source).filter((placement) => placement.skinId === 'deck'),
    ).toHaveLength(1);
    expect(placementById(source, 'deck-item')).toMatchObject({ width: 112, height: 112 });
    expect(layoutFor(source, skinId, 'page-1', 'missing')?.items).toEqual([]);
  });

  it('enforces registered type, accepted kinds, fixed footprint, collision and slot capacity at writes', () => {
    skins.set(skinId, skin);
    controlTypes.set(typeId, {
      type: typeId,
      title: 'Button',
      icon: 'Square',
      component: {} as any,
      size: { w: 1, h: 1 },
      maxSize: { w: 1, h: 1 },
      create: () => ({ name: 'Button', variants: [] }),
    } as any);
    controlTypes.set(otherTypeId, {
      type: otherTypeId,
      title: 'Other',
      icon: 'Square',
      component: {} as any,
      size: { w: 1, h: 1 },
      maxSize: { w: 1, h: 1 },
      create: () => ({ name: 'Other', variants: [] }),
    } as any);
    const source = structuredClone(DEFAULTS);
    source.controls = [
      { id: 'a', name: 'A', type: typeId, variants: [] },
      { id: 'b', name: 'B', type: typeId, variants: [] },
      { id: 'other', name: 'Other', type: otherTypeId, variants: [] },
    ] as any;
    const first = item('a-item', 'a', 0),
      second = item('b-item', 'b', 1);
    expect(
      setLayoutItems(source, { skinId, pageId: 'page-1', slotId: 'main' }, [first, second]),
    ).toBe(true);
    expect(layoutFor(source, skinId, 'page-1', 'main')?.items).toEqual([first, second]);
    expect(
      setLayoutItems(source, { skinId, pageId: 'page-1', slotId: 'main' }, [
        first,
        second,
        item('third', 'a', 0),
      ]),
    ).toBe(false);
    expect(
      setLayoutItems(source, { skinId, pageId: 'page-1', slotId: 'main' }, [
        first,
        { ...second, control: 'a' },
      ]),
    ).toBe(false);
    expect(
      setLayoutItems(source, { skinId, pageId: 'page-1', slotId: 'main' }, [
        first,
        { ...second, control: 'other' },
      ]),
    ).toBe(false);
    expect(layoutFor(source, skinId, 'page-1', 'main')?.items).toEqual([first, second]);
    source.skinLayouts.unavailable = { 'page-1': { hidden: [item('hidden-item', 'a', 0)] } };
    expect(
      setLayoutItems(source, { skinId, pageId: 'page-1', slotId: 'main' }, [first, second]),
    ).toBe(false);
    expect(
      validSlotItems(
        source,
        skinId,
        skin.slots[0],
        skin.slots[0].grid === 'page' ? source.deck.pages[0] : skin.slots[0].grid,
        [first, second],
      ),
    ).toBe(true);
    const impossible = { ...skin.slots[0], size: { w: 2, h: 1 } };
    expect(effectiveSize(skinId, impossible, typeId)).toBeUndefined();
  });

  it('validates target writes without changing settings or allocating controls', () => {
    skins.set(skinId, skin);
    controlTypes.set(typeId, {
      type: typeId,
      title: 'Button',
      icon: 'Square',
      component: {} as any,
      size: { w: 1, h: 1 },
      maxSize: { w: 1, h: 1 },
      create: () => ({ name: 'Button', variants: [] }),
    } as any);
    controlTypes.set(otherTypeId, {
      type: otherTypeId,
      title: 'Other',
      icon: 'Square',
      component: {} as any,
      size: { w: 1, h: 1 },
      maxSize: { w: 1, h: 1 },
      create: () => ({ name: 'Other', variants: [] }),
    } as any);
    const source = structuredClone(DEFAULTS);
    source.controls = [
      { id: 'a', name: 'A', type: typeId, variants: [] },
      { id: 'b', name: 'B', type: otherTypeId, variants: [] },
    ] as any;
    const target = { skinId, pageId: source.deck.pages[0].id, slotId: 'main' };
    const candidate = [item('candidate', 'a', 0)];
    const before = structuredClone(source);
    expect(canSetLayoutItems(source, target, candidate)).toBe(true);
    expect(canSetLayoutItems(source, target, [candidate[0], item('invalid', 'b', 1)])).toBe(false);
    expect(source).toEqual(before);
    expect(layoutFor(source, skinId, target.pageId, 'main')?.items).toEqual([]);
  });

  it('moves between stable page slots atomically while retaining placement and control IDs', () => {
    skins.set(skinId, skin);
    controlTypes.set(typeId, {
      type: typeId,
      title: 'Button',
      icon: 'Square',
      component: {} as any,
      size: { w: 1, h: 1 },
      maxSize: { w: 1, h: 1 },
      create: () => ({ name: 'Button', variants: [] }),
    } as any);
    const source = structuredClone(DEFAULTS);
    const sourcePage = { ...source.deck.pages[0], id: 'move-source', items: [] };
    const destinationPage = { ...source.deck.pages[0], id: 'move-destination', items: [] };
    source.deck.pages = [sourcePage, destinationPage];
    source.controls = [{ id: 'move-control', name: 'Move', type: typeId, variants: [] }] as any;
    source.skinLayouts = {
      [skinId]: { [sourcePage.id]: { main: [item('move-item', 'move-control', 1)] } },
    };

    const moved = movePlacementToSlot(source, 'move-item', {
      skinId,
      pageId: destinationPage.id,
      slotId: 'main',
    });
    expect(moved).toMatchObject({
      item: { id: 'move-item', control: 'move-control', x: 1, y: 0 },
      skinLayouts: {
        [skinId]: {
          [sourcePage.id]: { main: [] },
          [destinationPage.id]: { main: [expect.objectContaining({ id: 'move-item' })] },
        },
      },
    });
    expect(source.skinLayouts[skinId][sourcePage.id].main).toEqual([
      item('move-item', 'move-control', 1),
    ]);
    source.skinLayouts = moved!.skinLayouts;

    source.deck.pages[0].items = [item('deck-item', 'deck-control', 0)];
    source.controls.push({
      id: 'deck-control',
      name: 'Deck button',
      type: typeId,
      variants: [],
    } as any);
    const crossSkin = movePlacementToSlot(source, 'deck-item', {
      skinId,
      pageId: destinationPage.id,
      slotId: 'main',
    });
    expect(crossSkin?.item).toMatchObject({ id: 'deck-item', control: 'deck-control' });
    expect(crossSkin?.pages[0].items).toEqual([]);
    expect(
      crossSkin?.skinLayouts[skinId][destinationPage.id].main.map((entry) => entry.id),
    ).toEqual(['move-item', 'deck-item']);

    source.skinLayouts[skinId][destinationPage.id] = {
      main: [item('dest-a', 'dest-a-control', 0), item('dest-b', 'dest-b-control', 1)],
    };
    source.controls.push({ id: 'dest-a-control', name: 'A', type: typeId, variants: [] }, {
      id: 'dest-b-control',
      name: 'B',
      type: typeId,
      variants: [],
    } as any);
    const before = structuredClone(source.skinLayouts);
    expect(
      movePlacementToSlot(source, 'move-item', {
        skinId,
        pageId: destinationPage.id,
        slotId: 'main',
      }),
    ).toBeUndefined();
    expect(source.skinLayouts).toEqual(before);
  });

  it('leaves the live settings untouched while computing a move (no copy left on the destination)', () => {
    skins.set(skinId, skin);
    controlTypes.set(typeId, {
      type: typeId,
      title: 'Button',
      icon: 'Square',
      component: {} as any,
      size: { w: 1, h: 1 },
      create: () => ({ name: 'Button', variants: [] }),
    } as any);
    const source = structuredClone(DEFAULTS);
    const first = { ...source.deck.pages[0], id: 'page-a', items: [item('deck-item', 'c1', 0)] };
    const second = { ...source.deck.pages[0], id: 'page-b', items: [] };
    source.deck.pages = [first, second];
    source.controls = [
      { id: 'c1', name: 'One', type: typeId, variants: [] },
      { id: 'c2', name: 'Two', type: typeId, variants: [] },
    ] as any;
    source.skinLayouts = {
      [skinId]: { 'page-a': { main: [item('skin-item', 'c2', 0)] }, 'page-b': { main: [] } },
    };
    const before = structuredClone(source);

    const deckMove = movePlacementToSlot(source, 'deck-item', {
      skinId: 'deck',
      pageId: 'page-b',
      slotId: 'main',
    });
    const slotMove = movePlacementToSlot(source, 'skin-item', {
      skinId,
      pageId: 'page-b',
      slotId: 'main',
    });

    expect(deckMove?.pages[1].items.map((entry) => entry.id)).toEqual(['deck-item']);
    expect(slotMove?.skinLayouts[skinId]['page-b'].main.map((entry) => entry.id)).toEqual([
      'skin-item',
    ]);
    expect(source).toEqual(before);
  });
});

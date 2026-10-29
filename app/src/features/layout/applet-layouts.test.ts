import { afterEach, describe, expect, it } from 'vitest';
import { controlTypes, applets } from '../plugins/registry';
import { DEFAULTS } from '../settings/defaults';
import {
  canSetLayoutItems,
  layoutFor,
  movePlacementToSlot,
  placementById,
  setLayoutItems,
  effectiveSize,
} from './applet-layouts';
import { storedPlacements } from './placements';
import type { AppletDef } from '../applets/contracts';

const appletId = 'r5-layout-test';
const typeId = 'r5-layout-button';
const otherTypeId = 'r5-layout-other';
const deckTypeId = 'r5-deck-button';
const applet: AppletDef = {
  id: appletId,
  title: 'Test',
  component: {} as any,
  design: { width: 100, height: 100 },
  slots: [
    {
      id: 'main',

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
  applets.delete(appletId);
  controlTypes.delete(typeId);
  controlTypes.delete(otherTypeId);
  controlTypes.delete(deckTypeId);
});

describe('applet layout storage', () => {
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
    source.appletLayouts.deck = { 'page-1': { main: [item('ignored-alias', 'deck-control', 1)] } };
    expect(
      setLayoutItems(source, { appletId: 'deck', pageId: 'page-1', slotId: 'main' }, deckItems),
    ).toBe(true);
    expect(layoutFor(source, 'deck', source.deck.pages[0].id, 'main')?.items).toBe(deckItems);
    expect(source.deck.pages[0].items).toBe(deckItems);
    expect(source.appletLayouts).toEqual({});
    source.appletLayouts.deck = {
      'page-1': { main: [item('duplicate-alias', 'other-control', 1)] },
    };
    expect(
      storedPlacements(source).filter((placement) => placement.appletId === 'deck'),
    ).toHaveLength(1);
    expect(placementById(source, 'deck-item')).toMatchObject({ width: 112, height: 112 });
    expect(layoutFor(source, appletId, 'page-1', 'missing')?.items).toEqual([]);
  });

  it('enforces registered type, accepted kinds, fixed footprint, collision and slot capacity at writes', () => {
    applets.set(appletId, applet);
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
      setLayoutItems(source, { appletId, pageId: 'page-1', slotId: 'main' }, [first, second]),
    ).toBe(true);
    expect(layoutFor(source, appletId, 'page-1', 'main')?.items).toEqual([first, second]);
    expect(
      setLayoutItems(source, { appletId, pageId: 'page-1', slotId: 'main' }, [
        first,
        second,
        item('third', 'a', 0),
      ]),
    ).toBe(false);
    expect(
      setLayoutItems(source, { appletId, pageId: 'page-1', slotId: 'main' }, [
        first,
        { ...second, control: 'a' },
      ]),
    ).toBe(false);
    expect(
      setLayoutItems(source, { appletId, pageId: 'page-1', slotId: 'main' }, [
        first,
        { ...second, control: 'other' },
      ]),
    ).toBe(false);
    expect(layoutFor(source, appletId, 'page-1', 'main')?.items).toEqual([first, second]);
    source.appletLayouts.unavailable = { 'page-1': { hidden: [item('hidden-item', 'a', 0)] } };
    expect(
      setLayoutItems(source, { appletId, pageId: 'page-1', slotId: 'main' }, [first, second]),
    ).toBe(false);
    const impossible = { ...applet.slots[0], size: { w: 2, h: 1 } };
    expect(effectiveSize(appletId, impossible, typeId)).toBeUndefined();
  });

  it('validates target writes without changing settings or allocating controls', () => {
    applets.set(appletId, applet);
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
    const target = { appletId, pageId: source.deck.pages[0].id, slotId: 'main' };
    const candidate = [item('candidate', 'a', 0)];
    const before = structuredClone(source);
    expect(canSetLayoutItems(source, target, candidate)).toBe(true);
    expect(canSetLayoutItems(source, target, [candidate[0], item('invalid', 'b', 1)])).toBe(false);
    expect(source).toEqual(before);
    expect(layoutFor(source, appletId, target.pageId, 'main')?.items).toEqual([]);
  });

  it('moves between stable page slots atomically while retaining placement and control IDs', () => {
    applets.set(appletId, applet);
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
    source.appletLayouts = {
      [appletId]: { [sourcePage.id]: { main: [item('move-item', 'move-control', 1)] } },
    };

    const moved = movePlacementToSlot(source, 'move-item', {
      appletId,
      pageId: destinationPage.id,
      slotId: 'main',
    });
    expect(moved).toMatchObject({
      item: { id: 'move-item', control: 'move-control', x: 1, y: 0 },
      appletLayouts: {
        [appletId]: {
          [sourcePage.id]: { main: [] },
          [destinationPage.id]: { main: [expect.objectContaining({ id: 'move-item' })] },
        },
      },
    });
    expect(source.appletLayouts[appletId][sourcePage.id].main).toEqual([
      item('move-item', 'move-control', 1),
    ]);
    source.appletLayouts = moved!.appletLayouts;

    source.deck.pages[0].items = [item('deck-item', 'deck-control', 0)];
    source.controls.push({
      id: 'deck-control',
      name: 'Deck button',
      type: typeId,
      variants: [],
    } as any);
    const crossApplet = movePlacementToSlot(source, 'deck-item', {
      appletId,
      pageId: destinationPage.id,
      slotId: 'main',
    });
    expect(crossApplet?.item).toMatchObject({ id: 'deck-item', control: 'deck-control' });
    expect(crossApplet?.pages[0].items).toEqual([]);
    expect(
      crossApplet?.appletLayouts[appletId][destinationPage.id].main.map((entry) => entry.id),
    ).toEqual(['move-item', 'deck-item']);

    source.appletLayouts[appletId][destinationPage.id] = {
      main: [item('dest-a', 'dest-a-control', 0), item('dest-b', 'dest-b-control', 1)],
    };
    source.controls.push({ id: 'dest-a-control', name: 'A', type: typeId, variants: [] }, {
      id: 'dest-b-control',
      name: 'B',
      type: typeId,
      variants: [],
    } as any);
    const before = structuredClone(source.appletLayouts);
    expect(
      movePlacementToSlot(source, 'move-item', {
        appletId,
        pageId: destinationPage.id,
        slotId: 'main',
      }),
    ).toBeUndefined();
    expect(source.appletLayouts).toEqual(before);
  });

  it('leaves the live settings untouched while computing a move (no copy left on the destination)', () => {
    applets.set(appletId, applet);
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
    source.appletLayouts = {
      [appletId]: { 'page-a': { main: [item('applet-item', 'c2', 0)] }, 'page-b': { main: [] } },
    };
    const before = structuredClone(source);

    const deckMove = movePlacementToSlot(source, 'deck-item', {
      appletId: 'deck',
      pageId: 'page-b',
      slotId: 'main',
    });
    const slotMove = movePlacementToSlot(source, 'applet-item', {
      appletId,
      pageId: 'page-b',
      slotId: 'main',
    });

    expect(deckMove?.pages[1].items.map((entry) => entry.id)).toEqual(['deck-item']);
    expect(slotMove?.appletLayouts[appletId]['page-b'].main.map((entry) => entry.id)).toEqual([
      'applet-item',
    ]);
    expect(source).toEqual(before);
  });
});

describe('applet size overrides', () => {
  it('never place a widget below its registered minimum, whatever the applet says', () => {
    const { size: _fixed, ...free } = applet.slots[0];
    applets.set(appletId, {
      ...applet,
      slots: [{ ...free, grid: { rows: 2, cols: 4, size: 40, gap: 4, sizing: 'auto' } }],
      controlFaces: { [typeId]: { sizes: { main: { min: { w: 1, h: 1 } } } } } as any,
    });
    controlTypes.set(typeId, {
      type: typeId,
      title: 'Wide',
      icon: 'Square',
      component: {} as any,
      size: { w: 2, h: 2 },
      minSize: { w: 2, h: 2 },
      create: () => ({ name: 'Wide', variants: [] }),
    } as any);
    const source = structuredClone(DEFAULTS);
    source.controls = [{ id: 'w', name: 'Wide', type: typeId, variants: [] }] as any;
    const target = { appletId, pageId: 'page-1', slotId: 'main' };

    expect(canSetLayoutItems(source, target, [{ ...item('small', 'w', 0), w: 1, h: 1 }])).toBe(
      false,
    );
    expect(canSetLayoutItems(source, target, [{ ...item('fits', 'w', 0), w: 2, h: 2 }])).toBe(true);
  });
});

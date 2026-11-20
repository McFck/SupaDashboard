import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyScenario } from '../automation/scenario';
import { controlTypes } from '../plugins/registry';
import { settings } from '../settings/state.svelte';
import { DEFAULT_PAGE, DEFAULTS } from '../settings/defaults';
import type { ControlConfig } from '../controls/model';
import { deletePage } from './page-commands';
import { hasPlacement } from './placements';
import {
  duplicateInSlot,
  findSlotPlacement,
  finishGridResize,
  pasteInSlot,
  placeLinkedControl,
  unlinkPlacement,
} from './slot-edits';

const button = (id: string): ControlConfig => ({
  id,
  name: id,
  type: 'button',
  variants: [{ id: `${id}-state`, label: id }],
});

describe('grid shrink', () => {
  it('never leaves a configured control without a placement for a later page delete to discard', () => {
    const before = structuredClone(settings);
    try {
      const page = (id: string, items: [item: string, control: string, x: number][]) => ({
        ...structuredClone(DEFAULTS.deck.pages[0]),
        id,
        cols: 4,
        items: items.map(([item, control, x]) => ({ id: item, control, x, y: 0, w: 1, h: 1 })),
      });
      settings.deck.pages = [
        page('shrunk', [
          ['kept-item', 'kept', 0],
          ['cut-item', 'cut', 3],
          ['shared-cut-item', 'shared', 2],
        ]),
        page('other', [['shared-item', 'shared', 0]]),
        page('empty', []),
      ];
      settings.appletLayouts = {};
      settings.controls = [button('kept'), button('cut'), button('shared')];
      settings.variants = { cut: 0, shared: 0 };

      settings.deck.pages[0].cols = 2;
      finishGridResize('shrunk', { rows: settings.deck.pages[0].rows, cols: 4 });

      expect(settings.deck.pages[0].items.map((item) => item.id)).toEqual(['kept-item']);
      expect(settings.controls.map((control) => control.id)).toEqual(['kept', 'shared']);
      expect(settings.variants).not.toHaveProperty('cut');
      for (const control of settings.controls) {
        expect(hasPlacement(settings, control.id)).toBe(true);
      }
      deletePage('empty');
      expect(settings.controls.map((control) => control.id)).toEqual(['kept', 'shared']);
    } finally {
      Object.assign(settings, before);
    }
  });
});

describe('paste over a widget', () => {
  const typeId = 'slot-edits-test-button';
  afterEach(() => controlTypes.delete(typeId));

  it('drops only the replaced control and keeps every other control and variant', () => {
    const before = structuredClone(settings);
    try {
      controlTypes.set(typeId, { type: typeId, title: 'Button', size: { w: 1, h: 1 } } as never);
      const control = (id: string) => ({ ...button(id), type: typeId });
      settings.deck.pages = [
        {
          ...structuredClone(DEFAULTS.deck.pages[0]),
          id: 'page',
          items: [
            { id: 'old-item', control: 'old', x: 0, y: 0, w: 1, h: 1 },
            { id: 'keep-item', control: 'keep', x: 1, y: 0, w: 1, h: 1 },
          ],
        },
      ];
      settings.appletLayouts = {};
      settings.controls = [control('old'), control('keep')];
      settings.variants = { old: 0, keep: 0 };

      const id = pasteInSlot(
        { appletId: 'deck', pageId: 'page', slotId: 'main' },
        { control: control('copied'), w: 1, h: 1 },
        { item: 'old-item' },
        'Paste over widget',
      );

      const items = settings.deck.pages[0].items;
      expect(items.map((item) => item.id)).toEqual(['keep-item', id]);
      expect(items[1]).toMatchObject({ x: 0, y: 0, control: 'copied' });
      expect(settings.controls.map((entry) => entry.id)).toEqual(['keep', 'copied']);
      expect(settings.variants).toEqual({ keep: 0 });
    } finally {
      Object.assign(settings, before);
    }
  });
});

describe('new widget placement', () => {
  const type = 'test-widget';
  const target = { appletId: 'deck', pageId: DEFAULT_PAGE.id, slotId: 'main' };
  const initialPages = settings.deck.pages;
  const obstacle = { id: 'occupied', control: 'existing', x: 1, y: 1, w: 2, h: 3 };

  beforeEach(() => {
    controlTypes.set(type, {
      type,
      title: 'Widget',
      icon: 'Square',
      component: () => ({}),
      size: { w: 3, h: 3 },
      minSize: { w: 1, h: 2 },
      create: () => ({ name: 'Widget', scenario: emptyScenario(), variants: [] }),
    });
    settings.deck.pages = [{ ...DEFAULT_PAGE, rows: 4, cols: 4, items: [obstacle] }];
  });

  afterEach(() => {
    settings.deck.pages = initialPages;
    controlTypes.delete(type);
  });

  it('spawns the largest remaining size when the default is blocked', () => {
    settings.deck.pages[0].cols = 5;
    settings.deck.pages[0].items = [{ ...obstacle, x: 2 }];
    expect(findSlotPlacement(target, type, { cell: { x: 4, y: 0 } })).toEqual({
      x: 0,
      y: 0,
      w: 2,
      h: 3,
    });
  });

  it('keeps the default size when it fits anywhere in the slot', () => {
    settings.deck.pages[0].cols = 6;
    expect(findSlotPlacement(target, type, { cell: { x: 0, y: 0 } })).toEqual({
      x: 3,
      y: 0,
      w: 3,
      h: 3,
    });
  });

  it('rejects a new widget when even its minimum cannot fit', () => {
    settings.deck.pages[0].items = [{ ...obstacle, x: 0, w: 4 }];
    expect(findSlotPlacement(target, type)).toBeNull();
  });

  it('keeps explicit placement sizes exact when duplicating widgets', () => {
    expect(findSlotPlacement(target, type, { size: { w: 2, h: 2 } })).toBeNull();
  });
});

describe('linked widget placements', () => {
  const typeId = 'linked-test-button';
  afterEach(() => controlTypes.delete(typeId));

  it('links via placeLinkedControl and duplicateInSlot, and detaches only one placement on unlink', () => {
    const before = structuredClone(settings);
    try {
      controlTypes.set(typeId, { type: typeId, title: 'Button', size: { w: 1, h: 1 } } as never);
      const target = { appletId: 'deck', pageId: 'page', slotId: 'main' };
      settings.deck.pages = [
        {
          ...structuredClone(DEFAULTS.deck.pages[0]),
          id: 'page',
          cols: 4,
          rows: 2,
          items: [{ id: 'first', control: 'shared', x: 0, y: 0, w: 1, h: 1 }],
        },
      ];
      settings.appletLayouts = {};
      settings.controls = [{ ...button('shared'), type: typeId }];
      settings.variants = { shared: 1 };

      // Cannot unlink a control that is only placed once.
      expect(unlinkPlacement(target, 'first')).toBeUndefined();

      const linked = placeLinkedControl(target, 'shared', { x: 1, y: 0, w: 1, h: 1 }, 'Link');
      const dup = duplicateInSlot(target, 'first');
      expect(linked).toBeTruthy();
      expect(dup).toBeTruthy();
      expect(settings.controls).toHaveLength(1);
      expect(settings.deck.pages[0].items.map((item) => item.control)).toEqual([
        'shared',
        'shared',
        'shared',
      ]);

      const uniqueId = unlinkPlacement(target, linked!);
      expect(uniqueId).toBeTruthy();
      expect(uniqueId).not.toBe('shared');
      expect(settings.controls).toHaveLength(2);
      expect(settings.variants[uniqueId!]).toBe(1);
      expect(settings.deck.pages[0].items.find((item) => item.id === linked)?.control).toBe(
        uniqueId,
      );
      expect(settings.deck.pages[0].items.find((item) => item.id === 'first')?.control).toBe(
        'shared',
      );
      expect(settings.deck.pages[0].items.find((item) => item.id === dup)?.control).toBe('shared');

      // Replacing a linked placement with a linked paste of the same control keeps the control alive.
      const pasted = pasteInSlot(
        target,
        { control: settings.controls[0], w: 1, h: 1 },
        { item: 'first' },
        'Paste linked over widget',
        'link',
      );
      expect(pasted).toBeTruthy();
      expect(settings.controls.some((entry) => entry.id === 'shared')).toBe(true);
    } finally {
      Object.assign(settings, before);
    }
  });
});

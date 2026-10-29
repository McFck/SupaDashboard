import { afterEach, describe, expect, it } from 'vitest';
import { controlTypes } from '../plugins/registry';
import { settings } from '../settings/state.svelte';
import { DEFAULTS } from '../settings/defaults';
import type { ControlConfig } from '../controls/model';
import { deletePage } from './page-commands';
import { hasPlacement } from './placements';
import { finishGridResize, pasteInSlot } from './slot-edits';

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
      settings.skinLayouts = {};
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
      settings.skinLayouts = {};
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

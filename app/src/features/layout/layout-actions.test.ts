import { describe, expect, it } from 'vitest';
import type { ControlConfig } from '../controls/model';
import { duplicateWidget, pasteWidget } from './layout-actions';

const control: ControlConfig = {
  id: 'button',
  name: 'Button',
  type: 'button',
  variants: [
    { label: 'Tap', color: '#8ea8f0', action: { id: 'media.toggle', args: { source: 'system' } } },
    { label: 'Spotify', color: '#1db954' },
  ],
};
const item = { id: 'i', control: 'button', x: 0, y: 0, w: 1, h: 1 };
const grid = { rows: 2, cols: 2 };

describe('layout quick actions', () => {
  it('duplicates into free space with independent config and unique ids', () => {
    const copy = duplicateWidget({ control, w: 1, h: 1 }, [item], [item], [control], grid)!;
    expect(copy.item).toEqual({ id: 'i-2', control: 'button-2', x: 1, y: 0, w: 1, h: 1 });
    expect(copy.control.variants.map((v) => v.color)).toEqual(['#8ea8f0', '#1db954']);
    copy.control.variants[0].color = '#ffffff';
    expect(control.variants[0].color).toBe('#8ea8f0');
    copy.control.variants[0].action!.args!.source = 'spotify';
    expect(control.variants[0].action!.args!.source).toBe('system');
    expect(duplicateWidget({ control, w: 2, h: 2 }, [item], [item], [control], grid)).toBeNull();
  });
  it('allocates placement IDs against every page while checking fit only on the current page', () => {
    const otherPageItem = { id: 'i-2', control: 'other', x: 0, y: 0, w: 1, h: 1 };
    const otherSkinItem = { id: 'i-3', control: 'skin-control', x: 0, y: 0, w: 1, h: 1 };
    const copied = duplicateWidget(
      { control, w: 1, h: 1 },
      [item],
      [item, otherPageItem, otherSkinItem],
      [control],
      grid,
    )!;
    expect(copied.item.id).toBe('i-4');
    expect(copied.item.x).toBe(1);
  });
  it('pastes only where it fits, allowing confirmed replacement but protecting neighbors', () => {
    const copy = { control, w: 1, h: 1 };
    expect(pasteWidget(copy, [item], [item], [control], grid, item)).toBeNull();
    const pasted = pasteWidget(copy, [item], [item], [control], grid, item, item.id)!;
    expect(pasted.control.variants.map((v) => v.color)).toEqual(['#8ea8f0', '#1db954']);
    expect(
      pasteWidget(
        { ...copy, w: 2 },
        [item, { ...item, id: 'neighbor', x: 1 }],
        [item],
        [control],
        grid,
        item,
        item.id,
      ),
    ).toBeNull();
    expect(pasteWidget(copy, [], [], [], grid, { x: 2, y: 0 })).toBeNull();
  });

  it('keeps self targets local while preserving explicit cross-control targets in a duplicate', () => {
    const source: ControlConfig = {
      ...control,
      scenario: {
        triggers: {
          press: {
            steps: [
              {
                id: 'self',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'self', variant: 'state-2' } },
              },
              {
                id: 'external',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'other', variant: 'state-1' } },
              },
            ],
          },
        },
        events: [],
      },
    };
    const pasted = duplicateWidget(
      { control: source, w: 1, h: 1 },
      [item],
      [item],
      [source],
      grid,
    )!;
    const steps = pasted.control.scenario!.triggers.press!.steps;
    expect(pasted.control.variants.map((v) => v.id)).toEqual(source.variants.map((v) => v.id));
    expect(steps[0]).toMatchObject({ action: { args: { target: 'self', variant: 'state-2' } } });
    expect(steps[1]).toMatchObject({ action: { args: { target: 'other', variant: 'state-1' } } });
  });
});

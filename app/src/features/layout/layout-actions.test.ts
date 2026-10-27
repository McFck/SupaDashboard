import { describe, expect, it } from 'vitest';
import type { ControlConfig } from '../controls/model';
import { pasteWidget } from './layout-actions';

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
});

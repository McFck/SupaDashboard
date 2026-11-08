import { describe, expect, it } from 'vitest';
import { buildExistingControlRows } from './existing-controls';
import { pageItems } from './placements';

const types = new Map([
  ['button', { title: 'Button', icon: 'MousePointer2' }],
  ['slider', { title: 'Slider', icon: 'SlidersHorizontal' }],
]);

describe('existing controls', () => {
  it('counts shared placements and includes unplaced and unregistered controls', () => {
    const controls = [
      { id: 'b', name: 'Beta', type: 'button' },
      { id: 'a', name: 'Alpha', type: 'button' },
      { id: 'x', name: 'Unknown', type: 'plugin.unknown' },
    ];
    const rows = buildExistingControlRows(
      controls,
      [{ control: 'b' }, { control: 'b' }, { control: 'absent' }],
      types,
    );
    expect(rows.map((row) => [row.id, row.uses])).toEqual([
      ['a', 0],
      ['b', 2],
      ['x', 0],
    ]);
    expect(rows[2]).toMatchObject({
      typeTitle: 'plugin.unknown',
      icon: 'Puzzle',
    });
  });

  it('counts uses from page and applet placements while keeping page-local items separate', () => {
    const pages = [
      {
        id: 'one',
        name: 'One',
        rows: 2,
        cols: 2,
        size: 100,
        gap: 8,
        sizing: 'auto' as const,
        items: [{ id: 'one-item', control: 'b', x: 0, y: 0, w: 1, h: 1 }],
      },
      {
        id: 'two',
        name: 'Two',
        rows: 3,
        cols: 4,
        size: 80,
        gap: 4,
        sizing: 'manual' as const,
        items: [{ id: 'two-item', control: 'b', x: 2, y: 0, w: 1, h: 1 }],
      },
    ];
    const layouts = {
      subway: { one: { strip: [{ id: 'applet-item', control: 'b', x: 0, y: 0, w: 1, h: 1 }] } },
    };
    expect(
      buildExistingControlRows(
        [{ id: 'b', name: 'Beta', type: 'button' }],
        pageItems(pages, layouts),
        types,
      )[0].uses,
    ).toBe(3);
    expect(pages.map((page) => [page.cols, page.items.length])).toEqual([
      [2, 1],
      [4, 1],
    ]);
  });
});

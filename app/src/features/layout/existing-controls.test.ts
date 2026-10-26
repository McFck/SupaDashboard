import { describe, expect, it } from 'vitest';
import { buildExistingControlRows, searchExistingControls } from './existing-controls';
import { pageItems } from './pages';

const types = new Map([
  ['button', { title: 'Button', icon: 'MousePointer2', size: { w: 2, h: 1 } }],
  ['slider', { title: 'Slider', icon: 'SlidersHorizontal', size: { w: 3, h: 1 } }],
]);

describe('existing controls', () => {
  it('counts shared placements and includes unplaced and unavailable controls', () => {
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
      available: false,
      size: undefined,
    });
  });

  it('searches trimmed names, type IDs, and registered type titles case-insensitively', () => {
    const rows = buildExistingControlRows(
      [
        { id: 'one', name: 'Kitchen Light', type: 'button' },
        { id: 'two', name: 'Volume', type: 'slider' },
      ],
      [],
      types,
    );
    expect(searchExistingControls(rows, '  KITCHEN ').map((row) => row.id)).toEqual(['one']);
    expect(searchExistingControls(rows, ' SLIDER ').map((row) => row.id)).toEqual(['two']);
    expect(searchExistingControls(rows, 'button').map((row) => row.id)).toEqual(['one']);
  });

  it('sorts duplicate names by ID without changing source arrays and rebuilds counts from current items', () => {
    const controls = [
      { id: 'z', name: 'Same', type: 'button' },
      { id: 'a', name: 'same', type: 'button' },
    ];
    const originalControls = structuredClone(controls);
    const items = [{ control: 'z' }];
    const originalItems = structuredClone(items);
    expect(buildExistingControlRows(controls, items, types).map((row) => row.id)).toEqual([
      'a',
      'z',
    ]);
    expect(controls).toEqual(originalControls);
    expect(items).toEqual(originalItems);
    expect(
      buildExistingControlRows(controls, [...items, { control: 'z' }], types).find(
        (row) => row.id === 'z',
      )?.uses,
    ).toBe(2);
    expect(buildExistingControlRows(controls, [], types).find((row) => row.id === 'z')?.uses).toBe(
      0,
    );
  });

  it('counts uses from page and skin placements while keeping page-local items separate', () => {
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
      subway: { one: { strip: [{ id: 'skin-item', control: 'b', x: 0, y: 0, w: 1, h: 1 }] } },
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

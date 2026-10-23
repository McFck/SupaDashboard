import { describe, expect, it } from 'vitest';
import { buildExistingControlRows, searchExistingControls } from './existing-controls';

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
    const rows = buildExistingControlRows(controls, [{ control: 'b' }, { control: 'b' }, { control: 'absent' }], types);
    expect(rows.map(row => [row.id, row.uses])).toEqual([['a', 0], ['b', 2], ['x', 0]]);
    expect(rows[2]).toMatchObject({ typeTitle: 'plugin.unknown', icon: 'Puzzle', available: false, size: undefined });
  });

  it('searches trimmed names, type IDs, and registered type titles case-insensitively', () => {
    const rows = buildExistingControlRows([
      { id: 'one', name: 'Kitchen Light', type: 'button' },
      { id: 'two', name: 'Volume', type: 'slider' },
    ], [], types);
    expect(searchExistingControls(rows, '  KITCHEN ').map(row => row.id)).toEqual(['one']);
    expect(searchExistingControls(rows, ' SLIDER ').map(row => row.id)).toEqual(['two']);
    expect(searchExistingControls(rows, 'button').map(row => row.id)).toEqual(['one']);
  });

  it('sorts duplicate names by ID without changing source arrays and rebuilds counts from current items', () => {
    const controls = [{ id: 'z', name: 'Same', type: 'button' }, { id: 'a', name: 'same', type: 'button' }];
    const originalControls = structuredClone(controls);
    const items = [{ control: 'z' }];
    const originalItems = structuredClone(items);
    expect(buildExistingControlRows(controls, items, types).map(row => row.id)).toEqual(['a', 'z']);
    expect(controls).toEqual(originalControls);
    expect(items).toEqual(originalItems);
    expect(buildExistingControlRows(controls, [...items, { control: 'z' }], types).find(row => row.id === 'z')?.uses).toBe(2);
    expect(buildExistingControlRows(controls, [], types).find(row => row.id === 'z')?.uses).toBe(0);
  });
});

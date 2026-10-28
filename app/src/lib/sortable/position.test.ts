import { describe, expect, it } from 'vitest';
import { sortablePosition } from './position';

const bounds = [
  { start: 0, end: 40 },
  { start: 48, end: 88 },
  { start: 96, end: 136 },
];

describe('sortablePosition', () => {
  it('waits until the dragged leading edge passes a neighbour midpoint', () => {
    expect(sortablePosition(0, 28, bounds)).toEqual({ translation: 28, destination: 0 });
    expect(sortablePosition(0, 29, bounds)).toEqual({ translation: 29, destination: 1 });
  });

  it('moves backwards and across multiple neighbour midpoints', () => {
    expect(sortablePosition(2, -29, bounds)).toEqual({ translation: -29, destination: 1 });
    expect(sortablePosition(0, 120, bounds)).toEqual({ translation: 96, destination: 2 });
  });

  it('clamps the dragged item to the list and handles invalid bounds', () => {
    expect(sortablePosition(1, -200, bounds)).toEqual({ translation: -48, destination: 0 });
    expect(sortablePosition(1, 200, bounds)).toEqual({ translation: 48, destination: 2 });
    expect(sortablePosition(0, 20, [])).toEqual({ translation: 0, destination: 0 });
  });
});

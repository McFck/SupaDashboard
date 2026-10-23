import { describe, expect, it } from 'vitest';
import { deckSize, validGeometry } from './display';

describe('dashboard window geometry', () => {
  it('fits the grid plus its surrounding gap', () => {
    expect(deckSize({ cols: 6, rows: 3, size: 112, gap: 14 })).toEqual({ width: 770, height: 392 });
  });

  it('rejects unusable saved sizes and coordinates', () => {
    expect(validGeometry({ x: -1200, y: 100, width: 770, height: 392 })).toBe(true);
    expect(validGeometry({ x: 0, y: 0, width: 0, height: 392 })).toBe(false);
    expect(validGeometry({ x: Number.NaN, y: 0, width: 770, height: 392 })).toBe(false);
  });
});

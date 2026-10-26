import { describe, expect, it } from 'vitest';
import { pageSwipeIntent, pageSwipeOffset, pageSwipeTarget, pageSwipeThreshold } from './page-swipe';

describe('page swipe intent', () => {
  it('waits for the slop and locks the dominant axis at 1.25:1', () => {
    expect(pageSwipeIntent(7.99, 0)).toBe('pending');
    expect(pageSwipeIntent(8, 6.4)).toBe('horizontal');
    expect(pageSwipeIntent(-8, -6.41)).toBe('vertical');
    expect(pageSwipeIntent(0, 8)).toBe('vertical');
  });

  it('uses a bounded CSS-pixel commit threshold', () => {
    expect(pageSwipeThreshold(1365)).toBe(120);
    expect(pageSwipeThreshold(800)).toBe(120);
    expect(pageSwipeThreshold(500)).toBe(90);
    expect(pageSwipeThreshold(240)).toBe(48);
    expect(pageSwipeThreshold(0)).toBe(Infinity);
    expect(pageSwipeTarget(-119.99, 1365, 0, 3)).toBe(0);
    expect(pageSwipeTarget(-120, 1365, 0, 3)).toBe(1);
    expect(pageSwipeTarget(120, 1365, 2, 3)).toBe(1);
  });

  it('moves at most one page and respects release, cancellation and page bounds', () => {
    expect(pageSwipeTarget(-700, 800, 0, 4)).toBe(1);
    expect(pageSwipeTarget(700, 800, 3, 4)).toBe(2);
    expect(pageSwipeTarget(-500, 800, 3, 4)).toBe(3);
    expect(pageSwipeTarget(-500, 800, 1, 4, true)).toBe(1);
    expect(pageSwipeTarget(-500, 800, 1, 1)).toBe(1);
    expect(pageSwipeTarget(-500, NaN, 1, 4)).toBe(1);
  });

  it('rubber-bands outward at either edge, monotonically to the configured limit', () => {
    const limit = 96;
    const offsets = [0, 40, 80, 160, 8000].map(dx => pageSwipeOffset(dx, 800, 0, 3));
    expect(offsets[0]).toBe(0);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(offsets.at(-1)).toBeLessThan(limit);
    expect(offsets.at(-1)).toBeGreaterThan(94);
    expect(pageSwipeOffset(-800, 800, 2, 3)).toBe(-pageSwipeOffset(800, 800, 0, 3));
  });

  it('clamps inward movement to one adjacent page and handles invalid input', () => {
    expect(pageSwipeOffset(-900, 800, 0, 3)).toBe(-800);
    expect(pageSwipeOffset(900, 800, 2, 3)).toBe(800);
    expect(pageSwipeOffset(40, 0, 0, 3)).toBe(0);
    expect(pageSwipeOffset(NaN, 800, 0, 3)).toBe(0);
    expect(pageSwipeOffset(100, 800, 4, 3)).toBe(0);
  });
});

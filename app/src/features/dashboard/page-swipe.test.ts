import { describe, expect, it } from 'vitest';
import { pageSwipeIntent, pageSwipe } from './page-swipe';

describe('page swipe intent', () => {
  it('waits for the slop and locks the dominant axis at 1.25:1', () => {
    expect(pageSwipeIntent(7.99, 0)).toBe('pending');
    expect(pageSwipeIntent(8, 6.4)).toBe('horizontal');
    expect(pageSwipeIntent(-8, -6.41)).toBe('vertical');
    expect(pageSwipeIntent(0, 8)).toBe('vertical');
  });

  it('uses a bounded CSS-pixel commit threshold', () => {
    expect(pageSwipe(-119.99, 1365, 0, 3).targetIndex).toBe(0);
    expect(pageSwipe(-120, 1365, 0, 3).targetIndex).toBe(1);
    expect(pageSwipe(120, 1365, 2, 3).targetIndex).toBe(1);
  });

  it('moves at most one page and respects page bounds', () => {
    expect(pageSwipe(-700, 800, 0, 4).targetIndex).toBe(1);
    expect(pageSwipe(700, 800, 3, 4).targetIndex).toBe(2);
    expect(pageSwipe(-500, 800, 3, 4).targetIndex).toBe(3);
    expect(pageSwipe(-500, 800, 1, 1).targetIndex).toBe(1);
    expect(pageSwipe(-500, NaN, 1, 4).targetIndex).toBe(1);
  });

  it('rubber-bands outward at either edge, monotonically to the configured limit', () => {
    const limit = 96;
    const offsets = [0, 40, 80, 160, 8000].map((dx) => pageSwipe(dx, 800, 0, 3).offset);
    expect(offsets[0]).toBe(0);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(offsets.at(-1)).toBeLessThan(limit);
    expect(offsets.at(-1)).toBeGreaterThan(94);
    expect(pageSwipe(-800, 800, 2, 3).offset).toBe(-pageSwipe(800, 800, 0, 3).offset);
  });

  it('clamps inward movement to one adjacent page and handles invalid input', () => {
    expect(pageSwipe(-900, 800, 0, 3).offset).toBe(-800);
    expect(pageSwipe(900, 800, 2, 3).offset).toBe(800);
    expect(pageSwipe(40, 0, 0, 3).offset).toBe(0);
    expect(pageSwipe(NaN, 800, 0, 3).offset).toBe(0);
    expect(pageSwipe(100, 800, 4, 3).offset).toBe(0);
  });

  it('keeps the preview neighbor and release target together through reversal and overshoot', () => {
    for (const [dx, neighborIndex, offset] of [
      [-80, 2, -80],
      [150, 0, 150],
      [1200, 0, 800],
      [-1200, 2, -800],
    ]) {
      const swipe = pageSwipe(dx, 800, 1, 3);
      expect(swipe.neighborIndex).toBe(neighborIndex);
      expect(swipe.offset).toBe(offset);
      if (Math.abs(dx) >= 120) {
        expect(swipe.targetIndex).toBe(swipe.neighborIndex);
      }
    }
  });
});

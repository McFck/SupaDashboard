import { describe, expect, it } from 'vitest';
import { pageSwipe } from './page-swipe';

describe('page swipe intent', () => {
  it('moves at most one page and respects page bounds', () => {
    expect(pageSwipe(-700, 800, 0, 4).targetIndex).toBe(1);
    expect(pageSwipe(700, 800, 3, 4).targetIndex).toBe(2);
    expect(pageSwipe(-500, 800, 3, 4).targetIndex).toBe(3);
    expect(pageSwipe(-500, 800, 1, 1).targetIndex).toBe(1);
    expect(pageSwipe(-500, NaN, 1, 4).targetIndex).toBe(1);
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

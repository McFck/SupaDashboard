import { expect, it } from 'vitest';
import { VisibleClock } from './visible-clock';

it('freezes visible time while hidden and restarts it for a new run phase', () => {
  const clock = new VisibleClock();
  expect(clock.update('run', 1_000, true)).toBe(0);
  expect(clock.update('run', 9_000, false)).toBe(8_000);
  expect(clock.update('run', 109_000, true)).toBe(8_000);
  expect(clock.update('arriving', 109_500, true)).toBe(0);
});

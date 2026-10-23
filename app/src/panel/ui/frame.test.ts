import { expect, it } from 'vitest';
import { sidebarWidth } from './frame';

it('snaps the sidebar to a rail below the breakpoint and clamps expanded widths', () => {
  expect(sidebarWidth(-100)).toBe(64);
  expect(sidebarWidth(151)).toBe(64);
  expect(sidebarWidth(152)).toBe(192);
  expect(sidebarWidth(245.7)).toBe(246);
  expect(sidebarWidth(900)).toBe(320);
});

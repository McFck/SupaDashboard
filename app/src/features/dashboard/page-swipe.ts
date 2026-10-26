export type SwipeIntent = 'pending' | 'horizontal' | 'vertical';

export const SWIPE_INTENT_SLOP = 8;

export function pageSwipeIntent(dx: number, dy: number): SwipeIntent {
  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_INTENT_SLOP
  )
    return 'pending';
  return Math.abs(dx) >= 1.25 * Math.abs(dy) ? 'horizontal' : 'vertical';
}

export function pageSwipeThreshold(width: number) {
  return Number.isFinite(width) && width > 0 ? Math.min(120, Math.max(48, width * 0.18)) : Infinity;
}

function validPager(width: number, index: number, count: number) {
  return (
    Number.isFinite(width) &&
    width > 0 &&
    Number.isInteger(count) &&
    count > 0 &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < count
  );
}

export function pageSwipeOffset(dx: number, width: number, index: number, count: number) {
  if (!validPager(width, index, count) || !Number.isFinite(dx) || count <= 1) return 0;
  const limit = Math.min(96, width * 0.15);
  if (index === 0 && dx > 0) return (limit * dx) / (limit + dx);
  if (index === count - 1 && dx < 0) return (-limit * -dx) / (limit - dx);
  return Math.max(-width, Math.min(width, dx));
}

export function pageSwipeTarget(
  dx: number,
  width: number,
  index: number,
  count: number,
  cancelled = false,
) {
  if (
    cancelled ||
    !validPager(width, index, count) ||
    !Number.isFinite(dx) ||
    count <= 1 ||
    Math.abs(dx) < pageSwipeThreshold(width)
  )
    return index;
  if (dx < 0 && index < count - 1) return index + 1;
  if (dx > 0 && index > 0) return index - 1;
  return index;
}

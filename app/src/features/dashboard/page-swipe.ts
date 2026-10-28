export type SwipeIntent = 'pending' | 'horizontal' | 'vertical';

const SWIPE_INTENT_SLOP = 8;

export function pageSwipeIntent(dx: number, dy: number): SwipeIntent {
  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_INTENT_SLOP
  )
    return 'pending';
  return Math.abs(dx) >= 1.25 * Math.abs(dy) ? 'horizontal' : 'vertical';
}

function pageSwipeThreshold(width: number) {
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

export function pageSwipe(dx: number, width: number, index: number, count: number) {
  const rest = { offset: 0, side: 0, neighborIndex: index, targetIndex: index };
  if (!validPager(width, index, count) || !Number.isFinite(dx) || count <= 1 || dx === 0) {
    return rest;
  }
  const side = dx < 0 ? 1 : -1;
  const neighborIndex = index + side;
  if (neighborIndex < 0 || neighborIndex >= count) {
    const limit = Math.min(96, width * 0.15);
    return { ...rest, offset: (limit * dx) / (limit + Math.abs(dx)) };
  }
  return {
    offset: Math.max(-width, Math.min(width, dx)),
    side,
    neighborIndex,
    targetIndex: Math.abs(dx) >= pageSwipeThreshold(width) ? neighborIndex : index,
  };
}

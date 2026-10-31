export type SwipeIntent = 'pending' | 'horizontal' | 'vertical';

// Finger jitter on a tap reaches 10-15 px; a smaller slop turns it into a swipe that steals the pointer from the applet.
const SWIPE_INTENT_SLOP = 16;

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

export function pageSwipe(dx: number, width: number, index: number, count: number) {
  const rest = { offset: 0, side: 0, neighborIndex: index, targetIndex: index };
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(dx) || count <= 1 || dx === 0) {
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

export type PagerFrame = { id: string; offset: number; active: boolean; mediaVisible: boolean };

/** The page at rest plus its neighbours parked one width to either side. */
export function restingFrames(order: readonly string[], pageId: string, width: number) {
  const index = order.indexOf(pageId);
  const frames: PagerFrame[] = [{ id: pageId, offset: 0, active: true, mediaVisible: true }];
  if (index > 0) {
    frames.unshift({ id: order[index - 1], offset: -width, active: false, mediaVisible: false });
  }
  if (index >= 0 && index + 1 < order.length) {
    frames.push({ id: order[index + 1], offset: width, active: false, mediaVisible: false });
  }
  return frames;
}

/**
 * The source page following the pointer, with the neighbour on the side it moves towards. The other neighbour
 * stays parked: dropping it would unmount the page, and it would mount again blank when swiped in.
 */
export function swipeFrames(order: readonly string[], index: number, width: number, dx: number) {
  const { offset, side, neighborIndex } = pageSwipe(dx, width, index, order.length);
  const frames = restingFrames(order, order[index], width).map((frame) => ({
    ...frame,
    offset: frame.offset + offset,
    mediaVisible: frame.mediaVisible || (side !== 0 && frame.id === order[neighborIndex]),
  }));
  return { frames, side };
}

import { SPRING_SAMPLES } from '../spring';
import type { Axis } from './session';

/** Below this many pixels the dropped item is already where it was held. */
const SETTLED_DISTANCE = 0.5;
const MIN_DURATION = 160;
const MAX_DURATION = 260;

/**
 * Springs a reordered item from where it was held to its new slot. `held` is its rect at release; call after the
 * reorder has rendered. Returns null when it did not move. `transform` is the item's own transform to keep.
 */
export function settleDroppedItem(
  item: HTMLElement,
  held: DOMRect,
  axis: Axis,
  transform: string,
): Animation | null {
  const final = item.getBoundingClientRect();
  const offset = axis === 'x' ? held.left - final.left : held.top - final.top;
  if (Math.abs(offset) < SETTLED_DISTANCE) {
    return null;
  }
  const translate = (px: number) =>
    `translate${axis.toUpperCase()}(${px}px)${transform ? ` ${transform}` : ''}`;
  item.style.transition = 'none';
  item.style.transform = translate(offset);
  void item.getBoundingClientRect();
  const duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, 160 + Math.abs(offset) * 0.2));
  return item.animate(
    [
      { transform: translate(offset), offset: 0 },
      ...SPRING_SAMPLES.slice(1).map((sample) => ({
        transform: translate(offset * (1 - sample.progress)),
        offset: sample.offset,
      })),
      { transform: transform || 'none', offset: 1 },
    ],
    { duration, fill: 'both' },
  );
}

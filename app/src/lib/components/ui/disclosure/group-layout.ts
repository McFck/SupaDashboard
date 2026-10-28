import { tick } from 'svelte';
import { SPRING_SAMPLES } from '../../../spring';

export type GroupPosition = { element: HTMLElement; y: number };

export function groupPositions(list?: HTMLElement): GroupPosition[] {
  if (!list) return [];
  const groups = [...list.children].filter((node): node is HTMLElement =>
    node instanceof HTMLElement && node.hasAttribute('data-disclosure-group'));
  return groups.map(element => ({ element, y: element.getBoundingClientRect().top }));
}

type ListMotion = { pending: boolean; animations: Set<Animation> };
const listMotions = new WeakMap<HTMLElement, ListMotion>();

export function cancelGroupLayout(list?: HTMLElement) {
  if (!list) return;
  const motion = listMotions.get(list);
  if (!motion) return;
  motion.pending = false;
  for (const animation of motion.animations) animation.cancel();
  motion.animations.clear();
}

export function animateGroupLayout(list?: HTMLElement) {
  if (!list) return;
  let motion = listMotions.get(list);
  if (!motion) {
    motion = { pending: false, animations: new Set() };
    listMotions.set(list, motion);
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cancelGroupLayout(list);
    return;
  }
  if (motion.pending) return;

  const before = groupPositions(list);
  for (const animation of motion.animations) animation.cancel();
  motion.animations.clear();
  motion.pending = true;
  void tick().then(() => {
    if (!motion?.pending) return;
    const after = groupPositions(list);
    motion.pending = false;
    const afterByElement = new Map(after.map(position => [position.element, position.y]));
    for (const position of before) {
      const y = afterByElement.get(position.element);
      if (y === undefined) continue;
      const delta = position.y - y;
      if (!delta) continue;
      const animation = position.element.animate(SPRING_SAMPLES.map(({ offset, progress }) => ({
        offset,
        transform: `translateY(${delta * (1 - progress)}px)`,
      })), { duration: 240, easing: 'linear', fill: 'both' });
      motion.animations.add(animation);
      void animation.finished.then(() => {
        motion?.animations.delete(animation);
        animation.cancel();
      }, () => motion?.animations.delete(animation));
    }
  });
}


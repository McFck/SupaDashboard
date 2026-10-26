import { tick } from 'svelte';
import { SPRING_SAMPLES } from '../../../../features/controls/interaction';

export class MotionLifecycle {
  private generation = 0;
  private animations = new Set<Animation>();
  private timers = new Set<ReturnType<typeof setTimeout>>();

  begin() {
    this.cancelPending();
    return ++this.generation;
  }

  current(generation: number) { return generation === this.generation; }

  animate(node: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    const animation = node.animate(frames, options);
    this.animations.add(animation);
    return animation;
  }

  after(generation: number, delay: number, callback: () => void) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.current(generation)) callback();
    }, delay);
    this.timers.add(timer);
  }

  cancel() {
    this.generation++;
    this.cancelPending();
  }

  dispose() { this.cancel(); }

  private cancelPending() {
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

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

export type ContentPose = { opacity: number; y: number };

export function contentPose(node?: HTMLElement): ContentPose {
  if (!node) return { opacity: 1, y: 0 };
  const style = getComputedStyle(node);
  const opacity = Number.parseFloat(style.opacity);
  const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
  return { opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1, y: matrix.m42 };
}

export function contentFrames(from: ContentPose, to: ContentPose): Keyframe[] {
  return [
    { opacity: Math.max(0, Math.min(1, from.opacity)), transform: `translateY(${from.y}px)` },
    { opacity: Math.max(0, Math.min(1, to.opacity)), transform: `translateY(${to.y}px)` },
  ];
}

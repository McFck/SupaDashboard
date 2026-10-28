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

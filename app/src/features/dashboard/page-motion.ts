// Page frame nodes and their settle springs. Animations only move nodes; the pager decides which frames exist.
import { SPRING_SAMPLES, springDuration } from '$lib/spring';

const SETTLED_DISTANCE = 0.5;

type Frame = { id: string; offset: number };

export function pageOffset(offset: number) {
  return `translate3d(${Number.isFinite(offset) ? offset : 0}px,0,0)`;
}

function springKeyframes(from: number, to: number) {
  return SPRING_SAMPLES.map((sample) => ({
    transform: pageOffset(from + (to - from) * sample.progress),
    offset: sample.offset,
  }));
}

export class PageMotion {
  private readonly nodes = new Map<string, HTMLElement>();
  private animations: Animation[] = [];

  /** Svelte action for a page frame, so settle animations can reach it. */
  register = (node: HTMLElement, id: string) => {
    this.nodes.set(id, node);
    return {
      destroy: () => {
        if (this.nodes.get(id) === node) {
          this.nodes.delete(id);
        }
      },
    };
  };

  /** Springs every frame from its offset to `destination(frame)`; resolves when all have finished or were cancelled. */
  async spring<T extends Frame>(frames: readonly T[], destination: (frame: T) => number) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    this.animations = frames.flatMap((frame) => {
      const node = this.nodes.get(frame.id);
      const to = destination(frame);
      const distance = Math.abs(to - frame.offset);
      if (!node || distance < SETTLED_DISTANCE) {
        return [];
      }
      return [
        node.animate(springKeyframes(frame.offset, to), {
          duration: springDuration(distance),
          fill: 'both',
        }),
      ];
    });
    await Promise.all(
      this.animations.map((animation) => animation.finished.catch(() => undefined)),
    );
  }

  cancel() {
    for (const animation of this.animations) {
      animation.cancel();
    }
    this.animations = [];
  }
}

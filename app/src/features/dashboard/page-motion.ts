// Page frame nodes and their settle springs. Animations only move nodes; the pager decides which frames exist.
import { prefersReducedMotion } from 'svelte/motion';
import { springTranslate, springDuration } from '$lib/spring';

const SETTLED_DISTANCE = 0.5;

type Frame = { id: string; offset: number };

export function pageOffset(offset: number) {
  return `translate3d(${Number.isFinite(offset) ? offset : 0}px,0,0)`;
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
    if (prefersReducedMotion.current) {
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
        springTranslate(
          node,
          { x: frame.offset, y: 0 },
          { x: to, y: 0 },
          {
            duration: springDuration(distance),
            fill: 'both',
          },
        ),
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

// Spring motion for deck tiles: settling a released drag and animating tiles a layout change moved.
import { tick } from 'svelte';
import { prefersReducedMotion } from 'svelte/motion';
import { SPRING_SAMPLES, springDuration } from '$lib/spring';

type Point = { x: number; y: number };

/** Below this many pixels a tile counts as unmoved by a layout change. */
const MOVE_EPSILON = 0.5;
const MOVE_DURATION = 420;
const RESIZE_DURATION = 110;

function springFrames(x: number, y: number) {
  return SPRING_SAMPLES.map((sample) => ({
    offset: sample.offset,
    translate: `${x * (1 - sample.progress)}px ${y * (1 - sample.progress)}px`,
  }));
}

/** The tile's current `translate`, including one an animation is applying. */
export function readTranslation(node: HTMLElement): Point {
  const value = getComputedStyle(node).translate;
  if (value === 'none') {
    return { x: 0, y: 0 };
  }
  const [x, y] = value.split(/\s+/).map((part) => Number.parseFloat(part) || 0);
  return { x, y: y ?? 0 };
}

export class TileMotion {
  readonly nodes = new Map<string, HTMLElement>();
  /** Tiles above their neighbours while they animate. */
  readonly elevated = $state<Record<string, boolean>>({});
  private readonly animations = new Map<string, Animation>();
  private revision = 0;

  register = (node: HTMLElement, id: string) => {
    this.nodes.set(id, node);
    return {
      destroy: () => {
        this.nodes.delete(id);
      },
    };
  };

  get anyElevated() {
    return Object.values(this.elevated).some(Boolean);
  }

  stop(id: string) {
    this.animations.get(id)?.cancel();
    this.animations.delete(id);
    this.elevated[id] = false;
  }

  stopAll() {
    for (const id of [...this.animations.keys()]) {
      this.stop(id);
    }
  }

  /** Cancels pending layout animations, e.g. when the grid unmounts. */
  invalidate() {
    this.revision++;
    this.stopAll();
  }

  /** Springs a released tile from where the pointer left it back to its slot. */
  settle(id: string, node: HTMLElement, pose: Point, distance: number) {
    if (prefersReducedMotion.current || (!pose.x && !pose.y)) {
      return;
    }
    this.play(id, node, pose, springDuration(distance));
  }

  measure() {
    return new Map([...this.nodes].map(([id, node]) => [id, node.getBoundingClientRect()]));
  }

  /** After the DOM updates, springs every tile that moved from its `before` rectangle (FLIP). */
  animateFrom(before: Map<string, DOMRect>, scale: number) {
    const run = ++this.revision;
    void tick().then(() => {
      if (run !== this.revision) {
        return;
      }
      for (const [id, node] of this.nodes) {
        const from = before.get(id);
        const to = node.getBoundingClientRect();
        if (!from || !moved(from, to)) {
          continue;
        }
        const resized =
          Math.abs(from.width - to.width) > MOVE_EPSILON ||
          Math.abs(from.height - to.height) > MOVE_EPSILON;
        const delta = { x: (from.left - to.left) / scale, y: (from.top - to.top) / scale };
        this.play(id, node, delta, resized ? RESIZE_DURATION : MOVE_DURATION);
      }
    });
  }

  private play(id: string, node: HTMLElement, from: Point, duration: number) {
    this.elevated[id] = true;
    const animation = node.animate(springFrames(from.x, from.y), { duration, fill: 'both' });
    this.animations.set(id, animation);
    void animation.finished
      .then(() => {
        if (this.animations.get(id) !== animation) {
          return;
        }
        this.animations.delete(id);
        animation.cancel();
        this.elevated[id] = false;
      })
      .catch(() => {});
  }
}

function moved(from: DOMRect, to: DOMRect) {
  return (
    Math.abs(from.left - to.left) >= MOVE_EPSILON ||
    Math.abs(from.top - to.top) >= MOVE_EPSILON ||
    Math.abs(from.width - to.width) >= MOVE_EPSILON ||
    Math.abs(from.height - to.height) >= MOVE_EPSILON
  );
}

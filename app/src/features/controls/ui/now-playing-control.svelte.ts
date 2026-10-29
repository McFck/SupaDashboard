// Motion for the now-playing tile: the pull that follows the finger, the track swap and the spinning disc.
import { tick } from 'svelte';
import { prefersReducedMotion } from 'svelte/motion';
import { springDuration, springTranslate } from '$lib/spring';
import type { PullSnapshot } from '../input/pull';
import { watchDashboardVisibility, watchIntersection } from '../../media/content-visibility';

/** How long a committed pull may claim the next track change as its direction. */
const HINT_MS = 2000;
const SLIDE_MS = 420;
const FADE_MS = 220;
const TURN_MS = 2400;
const RAMP_MS = 900;

/** One rendered track: `key` changes only for a new track, `session` for a new player session. */
export type Frame<T> = { key: string; session: string; view: T };

type Host = {
  face(): HTMLElement | undefined;
  outgoing(): HTMLElement | undefined;
  /** The frame on screen now, which a committed pull remembers as its starting point. */
  shown(): Frame<unknown> | undefined;
};
type Motion =
  | { kind: 'idle' }
  | { kind: 'dragging'; pull: PullSnapshot }
  | { kind: 'settling' }
  | { kind: 'swapping' };
type Hint = { direction: 1 | -1; key: string; session: string };

const offsetOf = (node: HTMLElement) => {
  const transform = getComputedStyle(node).transform;
  return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
};

export class NowPlayingMotion<T> {
  motion = $state<Motion>({ kind: 'idle' });
  outgoing = $state<Frame<T> | null>(null);
  /** Pose a settle or swap was interrupted at; the next pull continues from there. */
  #base = $state(0);
  readonly translate = $derived.by(() => {
    const pull = this.motion.kind === 'dragging' ? this.motion.pull : null;
    const x = this.#base + (pull?.axis === 'x' ? pull.offset : 0);
    const y = pull?.axis === 'y' ? pull.offset : 0;
    return x || y ? `translate3d(${x}px, ${y}px, 0)` : 'none';
  });
  #hint: Hint | null = null;
  #hintTimer: ReturnType<typeof setTimeout> | undefined;
  #animations: Animation[] = [];
  #generation = 0;

  constructor(private readonly host: Host) {}

  /** A new pointer sequence interrupts any settle or swap at its rendered pose and drops the hint. */
  beginPull = () => {
    this.#clearHint();
    const face = this.host.face();
    const x = face && this.motion.kind !== 'idle' ? offsetOf(face) : this.#base;
    this.#stop();
    this.outgoing = null;
    this.#base = x;
    this.motion = { kind: 'idle' };
  };

  pull = (pull: PullSnapshot | null) => {
    if (pull) {
      this.motion = { kind: 'dragging', pull };
    }
  };

  /** ControlTile's release handler: commit exactly once, now, then spring back to rest. */
  release(snapshot: PullSnapshot, commit: () => void) {
    commit();
    const shown = this.host.shown();
    if (snapshot.armed && snapshot.axis === 'x' && shown) {
      this.#clearHint();
      this.#hint = {
        direction: snapshot.direction === 'swipeLeft' ? -1 : 1,
        key: shown.key,
        session: shown.session,
      };
      this.#hintTimer = setTimeout(() => this.#clearHint(), HINT_MS);
    }
    this.settle(snapshot);
  }

  settle = (snapshot: PullSnapshot | null) => {
    const face = this.host.face();
    const from = {
      x: this.#base + (snapshot?.axis === 'x' ? snapshot.offset : 0),
      y: snapshot?.axis === 'y' ? snapshot.offset : 0,
    };
    this.#stop();
    if (!face || !(from.x || from.y) || prefersReducedMotion.current) {
      this.#rest();
      return;
    }
    this.motion = { kind: 'settling' };
    this.#base = 0;
    const run = this.#generation;
    this.#play(
      [
        springTranslate(
          face,
          from,
          { x: 0, y: 0 },
          {
            duration: springDuration(Math.hypot(from.x, from.y)),
            easing: 'linear',
            fill: 'forwards',
          },
        ),
      ],
      run,
    );
  };

  /**
   * The widget moved to another track. A pull committed on the same session within the hint window slides
   * the old track off in the finger's direction; anything else crossfades without guessing a direction.
   */
  async show(previous: Frame<T> | undefined, next: Frame<T>) {
    if (!previous || previous.key === next.key) {
      return;
    }
    const hint = this.#hint;
    this.#clearHint();
    const direction =
      hint && hint.key === previous.key && hint.session === next.session ? hint.direction : 0;
    const face = this.host.face();
    const dragging = this.motion.kind === 'dragging';
    const from = face && !dragging ? offsetOf(face) : 0;
    this.#stop();
    const run = this.#generation;
    this.outgoing = previous;
    if (!dragging) {
      this.#base = 0;
      this.motion = { kind: 'swapping' };
    }
    await tick();
    const out = this.host.outgoing();
    if (run !== this.#generation || !face || !out) {
      return;
    }
    const reduced = prefersReducedMotion.current;
    const travel = direction && !reduced && !dragging ? direction * face.offsetWidth : 0;
    const timing = {
      duration: travel ? SLIDE_MS : reduced ? FADE_MS / 2 : FADE_MS,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'forwards' as const,
    };
    const moving = (x: number) => (dragging ? {} : { transform: `translate3d(${x}px, 0, 0)` });
    this.#play(
      [
        out.animate(
          [
            { ...moving(from), opacity: 1 },
            { ...moving(from + travel), opacity: travel ? 0.6 : 0 },
          ],
          timing,
        ),
        face.animate(
          [
            { ...moving(travel ? -travel : 0), opacity: travel ? 1 : 0 },
            { ...moving(0), opacity: 1 },
          ],
          timing,
        ),
      ],
      run,
    );
  }

  destroy() {
    this.#clearHint();
    this.#stop();
  }

  #play(animations: Animation[], run: number) {
    this.#animations = animations;
    void Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        if (run === this.#generation) {
          this.#stop();
          this.#rest();
        }
      },
      // Cancelled by a newer pull or swap, which owns the face from here.
      () => {},
    );
  }

  /** A swap can finish under a finger that is still pulling; that pull keeps the face. */
  #rest() {
    this.outgoing = null;
    if (this.motion.kind !== 'dragging') {
      this.#base = 0;
      this.motion = { kind: 'idle' };
    }
  }

  #stop() {
    this.#generation++;
    for (const animation of this.#animations) {
      animation.cancel();
    }
    this.#animations = [];
  }

  #clearHint() {
    clearTimeout(this.#hintTimer);
    this.#hint = null;
  }
}

/** Turns the record while it plays, easing up to speed and coasting to a stop. */
export class DiscSpin {
  #animation: Animation | undefined;
  #frame = 0;

  update(node: HTMLElement | undefined, playing: boolean, visible: boolean) {
    if (!node || prefersReducedMotion.current) {
      this.destroy();
      return;
    }
    if (!visible) {
      cancelAnimationFrame(this.#frame);
      this.#animation?.pause();
      return;
    }
    if (!this.#animation && playing) {
      this.#animation = node.animate([{ rotate: '0deg' }, { rotate: '360deg' }], {
        duration: TURN_MS,
        iterations: Infinity,
      });
      this.#animation.playbackRate = 0;
    }
    if (this.#animation) {
      this.#ramp(this.#animation, playing ? 1 : 0);
    }
  }

  destroy() {
    cancelAnimationFrame(this.#frame);
    this.#animation?.cancel();
    this.#animation = undefined;
  }

  #ramp(animation: Animation, target: number) {
    cancelAnimationFrame(this.#frame);
    const from = animation.playbackRate;
    const start = performance.now();
    animation.play();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / RAMP_MS);
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      animation.playbackRate = from + (target - from) * eased;
      if (t < 1) {
        this.#frame = requestAnimationFrame(step);
      } else if (!target) {
        animation.pause();
      }
    };
    this.#frame = requestAnimationFrame(step);
  }
}

/** Whether the tile is on screen: in the viewport, in a visible document and a shown dashboard. */
export function watchTileVisibility(node: HTMLElement, onChange: (visible: boolean) => void) {
  let intersecting = false;
  let dashboard = true;
  let stopDashboard = () => {};
  let disposed = false;
  const update = () =>
    onChange(intersecting && dashboard && document.visibilityState === 'visible');
  const stopIntersection = watchIntersection(node, (value) => {
    intersecting = value;
    update();
  });
  document.addEventListener('visibilitychange', update);
  void watchDashboardVisibility((value) => {
    dashboard = value;
    update();
  })
    .then((stop) => {
      if (disposed) {
        stop();
      } else {
        stopDashboard = stop;
      }
    })
    // Without the native signal the tile stays treated as shown, as media tiles do.
    .catch(() => {});
  return () => {
    disposed = true;
    stopIntersection();
    stopDashboard();
    document.removeEventListener('visibilitychange', update);
  };
}

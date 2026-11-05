// Drag, flick and wheel scrolling for one viewport, painted as a transform: momentum after a flick, a rubber
// band past the ends and spring glides. Native overflow scrolling felt dead on the dashboard's touch screen.

type Host = {
  /** The user grabbed, flicked or wheeled the content. */
  onInput(): void;
  /** Motion the user started has come to rest. */
  onRest(): void;
};
type Sample = { t: number; y: number };
/** Analytical motions, so every frame is one transform write and no layout read. */
type Motion =
  | { kind: 'idle' }
  | { kind: 'drag'; pointerId: number; fromY: number; fromPointer: number; samples: Sample[] }
  | { kind: 'decay'; y0: number; v0: number; t0: number }
  | { kind: 'wheel'; target: number; x0: number; t0: number }
  | {
      kind: 'spring';
      target: number;
      x0: number;
      v0: number;
      t0: number;
      w: number;
      user: boolean;
    };

/** Momentum kept per ms (iOS's normal deceleration rate). */
const DECAY = 0.998;
const LN_DECAY = Math.log(DECAY);
/** Below this (px/ms) a flick or a spring has stopped. */
const REST_SPEED = 0.02;
/** Release velocity is measured over this much of the drag's end (ms). */
const SAMPLE_MS = 80;
/** Spring stiffness (1/ms) of critically damped glides: settle back from the band, follow a line. */
const BOUNCE_W = 0.022;
const GLIDE_W = 0.011;
/** Time constant (ms) of the wheel's ease-out: a third of a notch lands on the next frame, all of it in ~200 ms. */
const WHEEL_TAU = 40;
/** Px per wheel "line" in line mode, as Chromium scrolls on Windows. */
const LINE_PX = 40;

/** iOS's rubber band: overshoot `distance` past an end shows as this, never more than `size`. */
const rubber = (distance: number, size: number) => size * (1 - 1 / ((distance * 0.55) / size + 1));

export class KineticScroll {
  readonly #viewport: HTMLElement;
  readonly #content: HTMLElement;
  readonly #host: Host;
  readonly #observer: ResizeObserver;
  #motion: Motion = { kind: 'idle' };
  #y = 0;
  #max = 0;
  #height = 0;
  #frame = 0;

  constructor(viewport: HTMLElement, content: HTMLElement, host: Host) {
    this.#viewport = viewport;
    this.#content = content;
    this.#host = host;
    this.#observer = new ResizeObserver(this.#measure);
    this.#observer.observe(viewport);
    this.#observer.observe(content);
    this.#measure();
    viewport.addEventListener('pointerdown', this.#down);
    viewport.addEventListener('pointermove', this.#move);
    viewport.addEventListener('pointerup', this.#up);
    viewport.addEventListener('pointercancel', this.#up);
    viewport.addEventListener('wheel', this.#wheel, { passive: false });
  }

  /** Viewport height in px, as last measured. */
  get height() {
    return this.#height;
  }

  /** Scrolls so `top` is at the viewport's top edge, gliding or at once. */
  scrollTo(top: number, smooth: boolean) {
    const target = this.#clamp(top);
    if (smooth) {
      this.#spring(target, GLIDE_W, false);
    } else {
      this.#motion = { kind: 'idle' };
      this.#paint(target);
    }
  }

  destroy() {
    cancelAnimationFrame(this.#frame);
    this.#observer.disconnect();
    this.#viewport.removeEventListener('pointerdown', this.#down);
    this.#viewport.removeEventListener('pointermove', this.#move);
    this.#viewport.removeEventListener('pointerup', this.#up);
    this.#viewport.removeEventListener('pointercancel', this.#up);
    this.#viewport.removeEventListener('wheel', this.#wheel);
  }

  #measure = () => {
    this.#height = this.#viewport.clientHeight;
    this.#max = Math.max(0, this.#content.offsetHeight - this.#height);
    if (this.#motion.kind === 'idle' && this.#clamp(this.#y) !== this.#y) {
      this.#paint(this.#clamp(this.#y));
    }
  };

  #clamp = (y: number) => Math.min(this.#max, Math.max(0, y));

  #band(y: number) {
    if (y < 0) {
      return -rubber(-y, this.#height);
    }
    return y > this.#max ? this.#max + rubber(y - this.#max, this.#height) : y;
  }

  #paint(y: number) {
    this.#y = y;
    this.#content.style.transform = `translate3d(0, ${-y}px, 0)`;
  }

  #down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }
    // A touch on moving content catches it where it is, as native scrolling does.
    cancelAnimationFrame(this.#frame);
    this.#viewport.setPointerCapture(event.pointerId);
    const now = performance.now();
    this.#motion = {
      kind: 'drag',
      pointerId: event.pointerId,
      fromY: this.#y,
      fromPointer: event.clientY,
      samples: [{ t: now, y: this.#y }],
    };
    this.#host.onInput();
  };

  #move = (event: PointerEvent) => {
    const motion = this.#motion;
    if (motion.kind !== 'drag' || motion.pointerId !== event.pointerId) {
      return;
    }
    const y = this.#band(motion.fromY + motion.fromPointer - event.clientY);
    const now = performance.now();
    motion.samples.push({ t: now, y });
    while (motion.samples.length > 2 && now - motion.samples[0].t > SAMPLE_MS) {
      motion.samples.shift();
    }
    // Painted right away: pointer events already arrive once per frame, so this lands on the next one.
    this.#paint(y);
  };

  #up = (event: PointerEvent) => {
    const motion = this.#motion;
    if (motion.kind !== 'drag' || motion.pointerId !== event.pointerId) {
      return;
    }
    const last = motion.samples.at(-1) ?? { t: 0, y: this.#y };
    const first = motion.samples[0];
    const now = performance.now();
    // A finger that stopped before lifting throws nothing.
    const v = now - last.t > 50 || last.t === first.t ? 0 : (last.y - first.y) / (last.t - first.t);
    cancelAnimationFrame(this.#frame);
    this.#paint(last.y);
    if (this.#clamp(last.y) !== last.y) {
      this.#spring(this.#clamp(last.y), BOUNCE_W, true, v);
    } else if (Math.abs(v) > REST_SPEED) {
      this.#motion = { kind: 'decay', y0: last.y, v0: v, t0: now };
      this.#frame = requestAnimationFrame(this.#step);
    } else {
      this.#motion = { kind: 'idle' };
      this.#host.onRest();
    }
  };

  #wheel = (event: WheelEvent) => {
    if (event.ctrlKey || this.#max === 0) {
      return;
    }
    event.preventDefault();
    const scale = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? this.#height : 1;
    const motion = this.#motion;
    const from = motion.kind === 'wheel' ? motion.target : this.#y;
    const target = this.#clamp(from + event.deltaY * scale);
    this.#host.onInput();
    // An ease-out, not a spring: it moves at full speed on the first frame, as native smooth scrolling does. It
    // starts at the last frame's time, so the next frame shows a full frame of progress.
    const frame = document.timeline.currentTime;
    const t0 = typeof frame === 'number' ? frame : performance.now();
    this.#motion = { kind: 'wheel', target, x0: this.#y - target, t0 };
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(this.#step);
  };

  /** Starts a critically damped spring from the current pose, keeping its speed unless one is given. */
  #spring(target: number, w: number, user: boolean, v0 = this.#velocity()) {
    this.#motion = {
      kind: 'spring',
      target,
      x0: this.#y - target,
      v0,
      t0: performance.now(),
      w,
      user,
    };
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(this.#step);
  }

  #velocity() {
    const motion = this.#motion;
    const t = performance.now() - ('t0' in motion ? motion.t0 : 0);
    if (motion.kind === 'decay') {
      return motion.v0 * DECAY ** t;
    }
    if (motion.kind === 'spring') {
      const { x0, v0, w } = motion;
      return (v0 - w * (v0 + w * x0) * t) * Math.exp(-w * t);
    }
    if (motion.kind === 'wheel') {
      return (-motion.x0 / WHEEL_TAU) * Math.exp(-t / WHEEL_TAU);
    }
    return 0;
  }

  #step = (now: number) => {
    const motion = this.#motion;
    const t = Math.max(0, now - ('t0' in motion ? motion.t0 : now));
    if (motion.kind === 'decay') {
      const v = motion.v0 * DECAY ** t;
      const y = motion.y0 + (motion.v0 * (DECAY ** t - 1)) / LN_DECAY;
      this.#paint(y);
      if (this.#clamp(y) !== y) {
        // Hitting an end turns what is left of the flick into an overshoot of at most an eighth of the view.
        const cap = (this.#height / 8) * BOUNCE_W * Math.E;
        this.#spring(this.#clamp(y), BOUNCE_W, true, Math.max(-cap, Math.min(cap, v)));
        return;
      }
      if (Math.abs(v) < REST_SPEED) {
        this.#rest(true);
        return;
      }
    } else if (motion.kind === 'spring') {
      const { target, x0, v0, w } = motion;
      const decay = Math.exp(-w * t);
      const x = (x0 + (v0 + w * x0) * t) * decay;
      const v = (v0 - w * (v0 + w * x0) * t) * decay;
      this.#paint(target + x);
      if (Math.abs(x) < 0.5 && Math.abs(v) < REST_SPEED) {
        this.#paint(target);
        this.#rest(motion.user);
        return;
      }
    } else if (motion.kind === 'wheel') {
      const x = motion.x0 * Math.exp(-t / WHEEL_TAU);
      if (Math.abs(x) < 0.5) {
        this.#paint(motion.target);
        this.#rest(true);
        return;
      }
      this.#paint(motion.target + x);
    } else {
      return;
    }
    this.#frame = requestAnimationFrame(this.#step);
  };

  #rest(user: boolean) {
    this.#motion = { kind: 'idle' };
    if (user) {
      this.#host.onRest();
    }
  }
}

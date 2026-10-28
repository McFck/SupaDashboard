// One press owner for a control: hold timing, double-tap pairing and the release decision. Pointer and keyboard
// adapters feed it; it never touches the DOM.
import { newId, TRIGGERS, type Trigger } from '../../automation/scenario';

const HOLD_MS = 550;
const DOUBLE_TAP_MS = 300;
/** How far apart, in CSS px, two taps may land and still pair. */
const DOUBLE_TAP_RADIUS = 24;

export type Captures = Partial<Record<Trigger, unknown>>;
export type Tap = { x: number; y: number; captures: Captures };
type Press = {
  captures: Captures;
  startedAt: number;
  long: boolean;
  moved: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
type PressOutput<T extends Tap> = {
  /** A hold, its release, or a paired double tap. */
  trigger(trigger: 'longPress' | 'longPressRelease' | 'doubleTap', captures: Captures): void;
  /** A short press that did not pair. */
  tap(tap: T): void;
};

/** Capture every trigger at press start, so a press keeps the meaning it had when it began. */
export function captureTriggers(
  capture?: (trigger: Trigger, interactionId: string) => unknown,
): Captures {
  const interactionId = newId();
  const captures: Captures = {};
  for (const trigger of TRIGGERS) {
    captures[trigger] = capture?.(trigger, interactionId);
  }
  return captures;
}

export class PressMachine<T extends Tap> {
  #press: Press | null = null;
  #pending: { tap: T; time: number; timer: ReturnType<typeof setTimeout> } | null = null;
  #out: PressOutput<T>;

  constructor(out: PressOutput<T>) {
    this.#out = out;
  }

  /** True once the current press has fired its hold. */
  get long() {
    return this.#press?.long ?? false;
  }

  /** Start a press; its hold fires after HOLD_MS unless it moves or ends first. */
  start(captures: Captures) {
    const press: Press = { captures, startedAt: performance.now(), long: false, moved: false };
    press.timer = setTimeout(() => this.#fireLong(press), HOLD_MS);
    this.#press = press;
  }

  /** The press moved beyond slop: it can no longer hold or tap, and an earlier tap stops waiting. */
  move() {
    const press = this.#press;
    if (!press || press.moved) {
      return;
    }
    press.moved = true;
    clearTimeout(press.timer);
    this.#flush();
  }

  /** Finish the press. 'moved' leaves the outcome (a pull or a value drag) to the caller. */
  end(tap: T): 'long' | 'moved' | 'short' | undefined {
    const press = this.#press;
    if (!press) {
      return undefined;
    }
    this.#press = null;
    clearTimeout(press.timer);
    // A release at the hold boundary can arrive before the timer task; it still counts as a hold, once.
    if (press.long || (!press.moved && performance.now() - press.startedAt >= HOLD_MS)) {
      this.#fireLong(press);
      this.#out.trigger('longPressRelease', press.captures);
      return 'long';
    }
    if (press.moved) {
      return 'moved';
    }
    this.tap(tap);
    return 'short';
  }

  /** A short press. It waits for a pair only when a Double tap binding was captured. */
  tap(tap: T) {
    const pairs = tap.captures.doubleTap !== undefined;
    const previous = this.#pending;
    if (previous) {
      this.#clearPending();
      const near =
        Math.hypot(tap.x - previous.tap.x, tap.y - previous.tap.y) < DOUBLE_TAP_RADIUS &&
        performance.now() - previous.time <= DOUBLE_TAP_MS;
      if (pairs && near) {
        this.#out.trigger('doubleTap', tap.captures);
        return;
      }
      this.#out.tap(previous.tap);
    }
    if (!pairs) {
      this.#out.tap(tap);
      return;
    }
    this.#pending = {
      tap,
      time: performance.now(),
      timer: setTimeout(() => {
        this.#pending = null;
        this.#out.tap(tap);
      }, DOUBLE_TAP_MS),
    };
  }

  /** Drop the press and any tap waiting for its pair without emitting anything. */
  cancel() {
    if (this.#press) {
      clearTimeout(this.#press.timer);
      this.#press = null;
    }
    this.#clearPending();
  }

  #fireLong(press: Press) {
    if (press.long) {
      return;
    }
    press.long = true;
    clearTimeout(press.timer);
    this.#flush();
    this.#out.trigger('longPress', press.captures);
  }

  #flush() {
    const previous = this.#pending;
    if (previous) {
      this.#clearPending();
      this.#out.tap(previous.tap);
    }
  }

  #clearPending() {
    if (this.#pending) {
      clearTimeout(this.#pending.timer);
    }
    this.#pending = null;
  }
}

import type { SceneInput, SceneRect } from './skin-scene';

export type SkinGesture = 'tripleTap' | 'cornerHold' | 'off';
export type SkinCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

type ActivePress = { pointerId: number; down: SceneInput; events: SceneInput[]; held: boolean };
type Timer = ReturnType<typeof setTimeout>;

export class SkinInputRecognizer {
  private gesture: SkinGesture = 'tripleTap';
  private corner: SkinCorner = 'bottomRight';
  private pending: SceneInput[][] = [];
  private lastTapUp?: SceneInput;
  private active?: ActivePress;
  private sequenceTimer?: Timer;
  private holdTimer?: Timer;
  private deliver?: (input: SceneInput) => void;

  constructor(private readonly onOpen: () => void,
    private readonly schedule: (callback: () => void, delay: number) => Timer = setTimeout,
    private readonly cancelTimer: (timer: Timer) => void = clearTimeout) {}

  setOptions(gesture: SkinGesture, corner: SkinCorner) {
    if (gesture === this.gesture && corner === this.corner) return;
    this.reset();
    this.gesture = gesture;
    this.corner = corner;
  }

  handle(input: SceneInput, rect: SceneRect, deliver: (input: SceneInput) => void) {
    this.deliver = deliver;
    if (this.gesture === 'off' || !Number.isFinite(input.screenX) || !Number.isFinite(input.screenY)) return false;
    if (input.kind === 'down') return this.down(input, rect);
    const active = this.active;
    if (!active || active.pointerId !== input.pointerId) return false;
    active.events.push(input);
    if (input.kind === 'move' && this.distance(active.down, input) > 8) {
      active.events.pop();
      this.flush();
      return false;
    }
    if (this.gesture === 'tripleTap') {
      if (input.kind === 'up') return this.finishTap(active, input);
      if (input.kind === 'cancel') { this.flush(); return true; }
      return true;
    }
    if (input.kind === 'up' || input.kind === 'cancel') {
      if (active.held) { this.active = undefined; this.clearHold(); return true; }
      this.flush();
      return true;
    }
    return true;
  }

  reset() { this.flush(); }

  dispose() {
    this.flush();
    this.deliver = undefined;
  }

  private down(input: SceneInput, rect: SceneRect) {
    if (input.button !== 0) return false;
    if (this.active) {
      this.flush(true);
      return false;
    }
    if (this.gesture === 'cornerHold') {
      if (!this.inCorner(input, rect)) return false;
      this.active = { pointerId: input.pointerId, down: input, events: [input], held: false };
      this.holdTimer = this.schedule(() => {
        const active = this.active;
        if (!active || active.pointerId !== input.pointerId) return;
        active.held = true;
        active.events = [];
        this.onOpen();
      }, 550);
      return true;
    }
    if (this.pending.length && this.lastTapUp && (input.time - this.lastTapUp.time > 350 || this.distance(this.lastTapUp, input) > 24))
      this.flush();
    this.clearSequence();
    this.active = { pointerId: input.pointerId, down: input, events: [input], held: false };
    return true;
  }

  private finishTap(active: ActivePress, up: SceneInput) {
    const duration = up.time - active.down.time;
    if (duration < 0 || duration > 200 || this.distance(active.down, up) > 24) {
      this.flush();
      return true;
    }
    this.pending.push(active.events);
    this.lastTapUp = up;
    this.active = undefined;
    if (this.pending.length === 3) {
      this.clearSequence();
      this.lastTapUp = undefined;
      this.onOpen();
      return true;
    }
    this.sequenceTimer = this.schedule(() => this.flush(), 350);
    return true;
  }

  private inCorner(input: SceneInput, rect: SceneRect) {
    const x = input.screenX!, y = input.screenY!;
    const left = x - rect.left <= 44, right = rect.left + rect.width - x <= 44;
    const top = y - rect.top <= 44, bottom = rect.top + rect.height - y <= 44;
    return this.corner === 'topLeft' ? left && top : this.corner === 'topRight' ? right && top
      : this.corner === 'bottomLeft' ? left && bottom : right && bottom;
  }

  private distance(a: SceneInput, b: SceneInput) {
    return Math.hypot(a.screenX! - b.screenX!, a.screenY! - b.screenY!);
  }

  private flush(cancelActive = false) {
    this.clearSequence();
    this.clearHold();
    const buffered = this.pending.flat();
    this.pending = [];
    this.lastTapUp = undefined;
    const active = this.active;
    this.active = undefined;
    if (active) {
      buffered.push(...active.events);
      if (cancelActive && active.events.at(-1)?.kind !== 'cancel')
        buffered.push({ ...active.down, kind: 'cancel', time: performance.now() });
    }
    for (const input of buffered) this.deliver?.(input);
  }

  private clearSequence() {
    if (this.sequenceTimer !== undefined) this.cancelTimer(this.sequenceTimer);
    this.sequenceTimer = undefined;
  }

  private clearHold() {
    if (this.holdTimer !== undefined) this.cancelTimer(this.holdTimer);
    this.holdTimer = undefined;
  }
}

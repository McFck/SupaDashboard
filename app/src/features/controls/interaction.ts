// Pointer interaction for controls: gesture classification and directional pulls.
import { selectTriggerSteps, type ActionStep } from '../automation/scenario';
import type { ControlConfig, Gesture, SwipeGesture } from './model';

export type PullAxis = 'x' | 'y';

export type PullEffect =
  | { kind: 'variant'; variant: number }
  | { kind: 'scenario'; trigger: SwipeGesture; title: string };
export type PullBindings = Partial<Record<SwipeGesture, PullEffect>>;

function simpleSelfVariant(control: ControlConfig, current: number, steps: ActionStep[] | undefined): number | undefined {
  if (!steps || steps.length !== 1 || steps[0].kind !== 'action') return undefined;
  const action = steps[0].action;
  if (action.id !== 'button.variant' || action.args?.target !== 'self') return undefined;
  const requested = String(action.args.variant ?? 'next');
  if (requested === 'next' || requested === 'prev') {
    const count = control.variants.length;
    return count ? ((current + (requested === 'next' ? 1 : -1) + count) % count) : 0;
  }
  const byId = control.variants.findIndex((variant, index) => (variant.id ?? `state-${index + 1}`) === requested);
  if (byId >= 0) return byId;
  if (/^\d+$/.test(requested)) {
    const index = Number(requested);
    return index >= 0 && index < control.variants.length ? index : undefined;
  }
  return undefined;
}

export type PullState = {
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
  width: number;
  height: number;
  lockedAxis: PullAxis | null;
  movedBeyondSlop: boolean;
  armed: boolean;
  armedDirection: SwipeGesture | null;
};

/** The complete pointer projection consumed by the renderer and release handler. */
export type PullSnapshot = {
  pointerId: number;
  axis: PullAxis;
  direction: SwipeGesture;
  offset: number;
  distance: number;
  progress: number;
  threshold: number;
  armed: boolean;
  effect: PullEffect;
};

export const PULL_SLOP = 8;

/** Resolve only canonical directional scenarios for pull preview. */
export function pullBindingsFor(control: ControlConfig, current: number, eligible?: readonly SwipeGesture[]): PullBindings {
  const result: PullBindings = {};
  const directions: SwipeGesture[] = ['swipeUp', 'swipeDown', 'swipeLeft', 'swipeRight'];
  const stateId = control.variants[current]?.id ?? `state-${current + 1}`;
  for (const direction of directions) {
    if (eligible && !eligible.includes(direction)) continue;
    const list = control.scenario?.triggers[direction];
    if (!list) continue;
    const steps = selectTriggerSteps(list, stateId);
    const preview = simpleSelfVariant(control, current, steps);
    if (preview !== undefined) {
      if (preview !== current) result[direction] = { kind: 'variant', variant: preview };
    } else result[direction] = { kind: 'scenario', trigger: direction, title: direction.replace('swipe', 'Pull ') };
  }
  return result;
}

export function beginPull(pointerId: number, x: number, y: number, time: number, width: number, height: number): PullState {
  return { pointerId, startX: x, startY: y, startTime: time,
    width: Number.isFinite(width) ? Math.max(0, width) : 0,
    height: Number.isFinite(height) ? Math.max(0, height) : 0,
    lockedAxis: null, movedBeyondSlop: false, armed: false, armedDirection: null };
}

function rubberDistance(distance: number, limit: number, threshold: number) {
  if (distance <= limit) return distance;
  return limit + .18 * threshold * (1 - Math.exp(-(distance - limit) / threshold));
}

/** Lock to the dominant axis at 8px and keep that axis until pointerup. */
export function updatePull(state: PullState, x: number, y: number, bindings: PullBindings): { state: PullState; snapshot: PullSnapshot | null } {
  const dx = x - state.startX, dy = y - state.startY;
  const movedBeyondSlop = state.movedBeyondSlop || Math.max(Math.abs(dx), Math.abs(dy)) >= PULL_SLOP;
  const lockedAxis = state.lockedAxis ?? (movedBeyondSlop ? (Math.abs(dx) > Math.abs(dy) ? 'x' : 'y') : null);
  if (!lockedAxis) return { state: { ...state, movedBeyondSlop }, snapshot: null };
  const projected = lockedAxis === 'x' ? dx : dy;
  const axisLength = lockedAxis === 'x' ? state.width : state.height;
  const direction: SwipeGesture = lockedAxis === 'x'
    ? projected >= 0 ? 'swipeRight' : 'swipeLeft'
    : projected >= 0 ? 'swipeDown' : 'swipeUp';
  const effect = bindings[direction];
  if (!effect || projected === 0) {
    return { state: { ...state, movedBeyondSlop, lockedAxis, armed: false, armedDirection: null }, snapshot: null };
  }
  const threshold = Math.min(48, Math.max(20, axisLength * .25));
  const distance = Math.abs(projected);
  const armed = distance >= threshold;
  const limit = axisLength * (effect.kind === 'variant' ? .25 : .125);
  const offset = Math.sign(projected) * rubberDistance(distance, Math.max(0, limit), threshold);
  const snapshot: PullSnapshot = { pointerId: state.pointerId, axis: lockedAxis, direction, offset,
    distance, progress: Math.min(1, distance / threshold), threshold, armed, effect };
  return { state: { ...state, movedBeyondSlop, lockedAxis, armed, armedDirection: armed ? direction : null }, snapshot };
}

export const SWIPE = 40; // px
const LONG_PRESS = 550; // ms
export const DOUBLE_TAP = 300; // ms

/** Classify a finished pointer movement. Slow short presses become long presses. */
export function classify(dx: number, dy: number, ms: number, sinceLastTap = Infinity): Gesture {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) {
    if (ms >= LONG_PRESS) return 'longPress';
    return sinceLastTap >= 0 && sinceLastTap <= DOUBLE_TAP ? 'doubleTap' : 'tap';
  }
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? 'swipeDown' : 'swipeUp';
  return dx > 0 ? 'swipeRight' : 'swipeLeft';
}

export function pullHandoffProgress(snapshot: Pick<PullSnapshot, 'armed' | 'effect'>) {
  return snapshot.effect.kind === 'variant' && snapshot.armed ? 1 : 0;
}

export function shouldAnimateSliderFill(input: {
  level: number | null; previousLevel: number | null; sourceKey: string; previousSourceKey: string;
  vertical: boolean; previousVertical: boolean; ready: boolean; dragging: boolean; reducedMotion: boolean;
}) {
  return input.ready && Number.isFinite(input.level) && Number.isFinite(input.previousLevel) &&
    input.sourceKey === input.previousSourceKey && input.vertical === input.previousVertical &&
    !input.dragging && !input.reducedMotion;
}

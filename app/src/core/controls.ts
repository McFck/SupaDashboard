// Controls are configured in settings; this file is pure logic so it can be unit-tested.
import type { ActionRef, ValueRef } from './registry';
import { selectTriggerSteps, type ActionStep, type Scenario, type StateBinding, type StateRoles, type Trigger } from './scenario';

/** Legacy trigger names accepted only while migrating older saved controls. */
export type Gesture = 'tap' | 'doubleTap' | 'longPress' | 'swipeUp' | 'swipeDown' | 'swipeLeft' | 'swipeRight';
export type { Trigger } from './scenario';
export type SwipeGesture = Extract<Gesture, `swipe${string}`>;
export type PullAxis = 'x' | 'y';

/** One mode of a control: prev for all media vs prev for Spotify only, system vs Spotify volume. */
export type Variant = { id?: string; label: string; icon?: string | null; color?: string | null; background?: string | null;
  /** Legacy action source, removed by normalizeControl. */ action?: ActionRef; value?: ValueRef };
/** A resolved, presentation-only view supplied by ACTIONS; these fields are never persisted here. */
export type TileAppearance = Pick<Variant, 'label' | 'icon' | 'color' | 'background'>;
export type TilePresentation = { key: string; view: TileAppearance };
export type SliderFaceState = { level: number | null; muted: boolean; orientation: 'vertical' | 'horizontal';
  active: boolean; fillReady: boolean; animateFill: boolean; sourceKey: string; accent: string };
export type ControlFaceProps = { appearance: TileAppearance; presentation: TilePresentation; stateId: string; stateIndex: number;
  busy: boolean; pull: PullSnapshot | null; compact: boolean; pixelWidth: number; pixelHeight: number; slider?: SliderFaceState };

/** A gesture either runs an action or switches the control to another variant. */
export type GestureBinding = ActionRef | { variant: 'next' | 'prev' | number };

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

/** Most states a control can have. */
export const MAX_VARIANTS = 4;

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

export type ControlConfig = {
  id: string;
  /** Internal editor name; tiles use the active variant label, including an empty label. */
  name: string;
  type: string; // 'button' | 'slider' | a plugin's control type
  /** Legacy field, migrated to variant colours on load. */
  color?: string;
  /** Widget-specific settings, e.g. the volume mixer's channels. */
  options?: Record<string, unknown>;
  variants: Variant[];
  scenario?: Scenario;
  stateBinding?: StateBinding;
  stateRoles?: StateRoles;
  /** Legacy trigger source, removed by normalizeControl. */
  gestures?: Partial<Record<Gesture, GestureBinding>>;
};

export const SWIPE = 40; // px
const SPRING_DAMPING = .82;
const SPRING_OMEGA = 20;
const SPRING_OMEGA_D = SPRING_OMEGA * Math.sqrt(1 - SPRING_DAMPING ** 2);

/** Underdamped spring response over elapsed seconds. */
export function springProgress(t: number) {
  if (!Number.isFinite(t) || t <= 0) return 0;
  return 1 - Math.exp(-SPRING_DAMPING * SPRING_OMEGA * t) *
    (Math.cos(SPRING_OMEGA_D * t) + SPRING_DAMPING / Math.sqrt(1 - SPRING_DAMPING ** 2) * Math.sin(SPRING_OMEGA_D * t));
}

/** Shared normalized spring samples; the final frame is exact even if the curve has a tiny residual. */
export const SPRING_SAMPLES = Array.from({ length: 32 }, (_, i) => ({
  offset: i / 31,
  progress: i === 31 ? 1 : springProgress(.52 * i / 31),
}));

/** Longer rejected drags get a longer return, capped to keep the interaction responsive. */
export function springDuration(distanceInScreenPx: number) {
  const distance = Number.isFinite(distanceInScreenPx) ? Math.max(0, distanceInScreenPx) : 0;
  return Math.max(360, Math.min(520, 320 + .25 * distance));
}

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

/** Gestures a widget can use: sliders keep their drag axis for the value, so only cross-axis swipes remain. */
export function availableGestures(type: string, w: number, h: number, compact = false): Gesture[] {
  if (type === 'button' || type === 'media' || type === 'web') return ['swipeDown', 'swipeUp', 'swipeLeft', 'swipeRight', 'longPress', 'doubleTap'];
  if (type === 'slider') return !compact && sliderOrientation(w, h) === 'vertical'
    ? ['swipeLeft', 'swipeRight', 'longPress', 'doubleTap'] : ['swipeDown', 'swipeUp', 'longPress', 'doubleTap'];
  return [];
}

/** Use the longer pixel dimension as the slider travel; square widgets prefer vertical. */
export function sliderOrientation(width: number, height: number): 'vertical' | 'horizontal' {
  return height >= width ? 'vertical' : 'horizontal';
}

/** Keep the button glyph proportional to the resolved footprint, including a live resize draft. */
export function buttonIconSize(width: number, height: number, compact = false) {
  return compact ? 20 : Math.min(38, Math.max(0, Math.min(width, height)) * .34);
}

/** Pointer-local ripple bounds corrected for a uniform scale around the tile center. */
export function pressRippleGeometry(width: number, height: number, clientX: number, clientY: number,
  rect: { left: number; top: number }, scale = 1) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const x = width / 2 + (clientX - rect.left - width / 2) / safeScale;
  const y = height / 2 + (clientY - rect.top - height / 2) / safeScale;
  const diameter = Math.max(1, 2 * Math.max(Math.hypot(x, y), Math.hypot(width - x, y),
    Math.hypot(x, height - y), Math.hypot(width - x, height - y)));
  return { x, y, diameter };
}

/** Project a captured logical-pixel grab point to the tile's nearest grid-origin snap. */
export function projectMoveOrigin(clientX: number, clientY: number,
  geometry: { gridLeft: number; gridTop: number; scale: number; pitch: number; gap: number },
  grab: { x: number; y: number }, source: { x: number; y: number }) {
  const originX = (clientX - geometry.gridLeft) / geometry.scale - grab.x;
  const originY = (clientY - geometry.gridTop) / geometry.scale - grab.y;
  // Math.round sends exact negative half ties toward +infinity; both sides around the tie remain symmetric.
  const snap = (origin: number) => Math.round((origin - geometry.gap) / geometry.pitch) || 0;
  return { x: snap(originX), y: snap(originY), originX, originY,
    translateX: originX - (source.x * geometry.pitch + geometry.gap),
    translateY: originY - (source.y * geometry.pitch + geometry.gap) };
}

/** Continuous frame preview in pixels; only the eventual drop is snapped to cells. */
export function resizePreview(rect: { w: number; h: number }, corner: ResizeCorner, dx: number, dy: number,
  pitch: number, gap: number, min = { w: 1, h: 1 }, max = { w: 99, h: 99 }) {
  const baseW = rect.w * pitch - gap, baseH = rect.h * pitch - gap;
  const west = corner.includes('w'), north = corner.includes('n');
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo * pitch - gap, Math.min(hi * pitch - gap, n));
  const width = clamp(baseW + dx * (west ? -1 : 1), min.w, max.w);
  const height = clamp(baseH + dy * (north ? -1 : 1), min.h, max.h);
  return { x: west ? baseW - width : 0, y: north ? baseH - height : 0, width, height };
}

/** Compare the actual pill footprints after card padding and channel gaps. */
export function mixerLayout(width: number, height: number, channels: number, padding = 12, gap = 10): 'vertical' | 'horizontal' {
  const n = Math.max(1, channels);
  const w = Math.max(0, width - padding * 2), h = Math.max(0, height - padding * 2);
  const vw = Math.max(0, (w - gap * (n - 1)) / n), hh = Math.max(0, (h - gap * (n - 1)) / n);
  const verticalMin = Math.min(vw, h), horizontalMin = Math.min(w, hh);
  if (verticalMin !== horizontalMin) return verticalMin > horizontalMin ? 'vertical' : 'horizontal';
  if (vw * h !== w * hh) return vw * h > w * hh ? 'vertical' : 'horizontal';
  return h >= w ? 'vertical' : 'horizontal';
}

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

/** Resize from a corner while keeping the opposite corner anchored, in grid cells. */
export function resizeFromCorner(rect: { x: number; y: number; w: number; h: number }, corner: ResizeCorner,
  dx: number, dy: number, pitch: number, min = { w: 1, h: 1 }, max = { w: 99, h: 99 }) {
  const west = corner.includes('w'), north = corner.includes('n');
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const w = clamp(rect.w + Math.round(dx / pitch) * (west ? -1 : 1), min.w, max.w);
  const h = clamp(rect.h + Math.round(dy / pitch) * (north ? -1 : 1), min.h, max.h);
  return { x: west ? rect.x + rect.w - w : rect.x, y: north ? rect.y + rect.h - h : rect.y, w, h };
}

/** Resize with a pixel deadband around each half-cell snap boundary. `previous` is the last snapped draft. */
export function resizeFromCornerHysteretic(rect: { x: number; y: number; w: number; h: number }, corner: ResizeCorner,
  dx: number, dy: number, pitch: number, previous: { w: number; h: number } = rect,
  min = { w: 1, h: 1 }, max = { w: 99, h: 99 }, hysteresis = 4) {
  const west = corner.includes('w'), north = corner.includes('n');
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const snap = (delta: number, prior: number, low: number, high: number) => {
    if (!(pitch > 0) || !Number.isFinite(pitch) || !Number.isFinite(delta)) return prior;
    const deadband = Number.isFinite(hysteresis) ? Math.max(0, hysteresis) : 4;
    let cells = clamp(prior, low, high);
    while (cells < high && delta >= (cells + .5) * pitch + deadband) cells++;
    while (cells > low && delta <= (cells - .5) * pitch - deadband) cells--;
    return cells;
  };
  const xSign = west ? -1 : 1, ySign = north ? -1 : 1;
  const xBounds = [(min.w - rect.w) * xSign, (max.w - rect.w) * xSign].sort((a, b) => a - b);
  const yBounds = [(min.h - rect.h) * ySign, (max.h - rect.h) * ySign].sort((a, b) => a - b);
  const dw = snap(dx, (previous.w - rect.w) * xSign, xBounds[0], xBounds[1]);
  const dh = snap(dy, (previous.h - rect.h) * ySign, yBounds[0], yBounds[1]);
  const w = rect.w + dw * xSign;
  const h = rect.h + dh * ySign;
  return { x: west ? rect.x + rect.w - w : rect.x, y: north ? rect.y + rect.h - h : rect.y, w, h };
}

/** Handle hit boxes stay clickable beyond a tile edge while the visible corner mark stays outside it. */
export function resizeCornerGeometry(width: number, height: number, corner: ResizeCorner) {
  const hitSize = 28, hitOffset = 3, strokeSize = 12;
  const west = corner.includes('w'), north = corner.includes('n');
  const centerX = west ? -hitOffset : width + hitOffset;
  const centerY = north ? -hitOffset : height + hitOffset;
  return { hitSize, strokeSize, strokeGap: hitOffset, hitX: centerX - hitSize / 2, hitY: centerY - hitSize / 2,
    strokeX: west ? -hitOffset - strokeSize : width + hitOffset,
    strokeY: north ? -hitOffset - strokeSize : height + hitOffset };
}

/** Move a state; scenario references use stable IDs. Returns the reordered current index. */
export function moveVariant(control: ControlConfig, current: number, from: number, to: number): number {
  const n = control.variants.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return current;
  const [moved] = control.variants.splice(from, 1);
  control.variants.splice(to, 0, moved);
  const remap = (i: number) => i === from ? to : from < to && i > from && i <= to ? i - 1 : from > to && i >= to && i < from ? i + 1 : i;
  return remap(current);
}

/** Remove a state and repair only references scoped to that control. */
export function removeVariant(control: ControlConfig, current: number, index: number): number {
  const n = control.variants.length;
  if (n < 2 || index < 0 || index >= n) return current;
  const removedId = control.variants[index].id ?? `state-${index + 1}`;
  const replacement = control.variants[Math.min(index, n - 2)];
  const replacementId = replacement.id ?? `state-${Math.min(index, n - 2) + 1}`;
  control.variants.splice(index, 1);
  const remap = (i: number) => i === index ? Math.min(index, n - 2) : i > index ? i - 1 : i;

  const visit = (steps: import('./scenario').ActionStep[] = []) => {
    for (const step of steps) {
      if (step.kind === 'action' && step.action.id === 'button.variant' && step.action.args?.target === 'self' &&
        step.action.args.variant === removedId) step.action.args.variant = replacementId;
      else if (step.kind === 'if') { visit(step.then); visit(step.else); }
    }
  };
  for (const list of Object.values(control.scenario?.triggers ?? {})) {
    if (!list) continue;
    delete list.byState?.[removedId];
    visit(list.steps);
    for (const steps of Object.values(list.byState ?? {})) visit(steps);
  }
  for (const event of control.scenario?.events ?? []) {
    delete event.list.byState?.[removedId];
    visit(event.list.steps);
    for (const steps of Object.values(event.list.byState ?? {})) visit(steps);
  }
  if (control.stateBinding) control.stateBinding.cases = control.stateBinding.cases.filter(item => item.stateId !== removedId);
  if (control.stateRoles && (control.stateRoles.off === removedId || control.stateRoles.on === removedId))
    delete control.stateRoles;
  return remap(current);
}

// Pointer handling shared by controls. Pull and tap decisions happen only after cancellation checks.
import {
  beginPull,
  classify,
  DOUBLE_TAP,
  updatePull,
  type PullBindings,
  type PullSnapshot,
  type PullState,
} from './interaction';
import type { Gesture } from './model';
import type { Trigger } from '../automation/scenario';

/** Delay a single tap only when a double-tap binding exists. Distant taps stay independent. */
export function tapSequence(emit: (g: Gesture, x: number, y: number, captured?: unknown) => void) {
  let pending: {
    x: number;
    y: number;
    t: number;
    captured?: unknown;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  const sendEvent = (g: Gesture, x: number, y: number, captured?: unknown) =>
    captured === undefined ? emit(g, x, y) : emit(g, x, y, captured);
  function cancel() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  }
  function send(g: Gesture, x: number, y: number, doubleTap = false, captured?: unknown) {
    const previous = pending;
    if (previous) {
      cancel();
      if (
        g === 'tap' &&
        doubleTap &&
        Math.hypot(x - previous.x, y - previous.y) < 24 &&
        classify(0, 0, 0, performance.now() - previous.t) === 'doubleTap'
      ) {
        sendEvent('doubleTap', x, y, captured);
        return;
      }
      sendEvent('tap', previous.x, previous.y, previous.captured);
    }
    if (g !== 'tap' || !doubleTap) {
      emit(g, x, y);
      return;
    }
    pending = {
      x,
      y,
      t: performance.now(),
      captured,
      timer: setTimeout(() => {
        pending = null;
        sendEvent('tap', x, y, captured);
      }, DOUBLE_TAP),
    };
  }
  return { send, cancel };
}

const HOLD_MS = 550;
const triggerList: readonly Trigger[] = [
  'press',
  'release',
  'longPress',
  'longPressRelease',
  'doubleTap',
  'swipeUp',
  'swipeDown',
  'swipeLeft',
  'swipeRight',
];
type Captured = Partial<Record<Trigger, unknown>>;
type ActivePull = {
  state: PullState;
  bindings: PullBindings;
  snapshot: PullSnapshot | null;
  captures: Captured;
  interactionId: string;
  holdTimer?: ReturnType<typeof setTimeout>;
  longStarted: boolean;
};
type PendingShort = {
  x: number;
  y: number;
  time: number;
  captures: Captured;
  doubleTap: boolean;
  timer: ReturnType<typeof setTimeout>;
};
type GestureHandlers = {
  onGesture: (g: Gesture, snapshot?: PullSnapshot, captured?: unknown) => void;
  onTrigger?: (trigger: Trigger, captured?: unknown, snapshot?: PullSnapshot) => void;
  captureTrigger?: (trigger: Trigger, interactionId: string) => unknown;
  doubleTap?: boolean;
  enabled?: boolean;
  /** Current pull preview. This never runs a bound action or changes a variant. */
  onPull?: (pull: PullSnapshot | null) => void;
  /** Called once on pointerup after slop, including blocked and unarmed releases. */
  onPullEnd?: (snapshot: PullSnapshot | null, armed: boolean) => void;
  /** Called for cancellation/lost capture, never for a commit. */
  onCancel?: (snapshot: PullSnapshot | null) => void;
  /** Direction bindings are captured at pointerdown so an active pull cannot change meaning. */
  pullBindings?: PullBindings | (() => PullBindings);
  onStart?: () => void;
};

function makeInteractionId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `gesture-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/** Pointer action with hold-time and paired short triggers, captured settings, and one release decision. */
export function gestures(node: HTMLElement, initial: GestureHandlers) {
  let handlers = initial;
  let active: ActivePull | null = null;
  let keyboard: {
    captures: Captured;
    interactionId: string;
    startedAt: number;
    longStarted: boolean;
    holdTimer: ReturnType<typeof setTimeout>;
  } | null = null;
  let pending: PendingShort | null = null;
  let suppressSyntheticClick = false;
  let clickSuppressionTimer: ReturnType<typeof setTimeout> | undefined;

  const capture = (interactionId: string): Captured => {
    const result: Captured = {};
    for (const trigger of triggerList)
      result[trigger] = handlers.captureTrigger?.(trigger, interactionId);
    return result;
  };
  const dispatch = (trigger: Trigger, captures: Captured, snapshot?: PullSnapshot) => {
    const captured = captures[trigger];
    if (handlers.onTrigger) handlers.onTrigger(trigger, captured, snapshot);
    else if (trigger === 'press') handlers.onGesture('tap');
    else if (trigger === 'longPress' || trigger === 'doubleTap' || trigger.startsWith('swipe'))
      handlers.onGesture(trigger as Gesture, snapshot, captured);
  };
  const clearHold = (interaction: ActivePull | NonNullable<typeof keyboard>) => {
    if (interaction.holdTimer) clearTimeout(interaction.holdTimer);
  };
  const clearPending = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };
  const flushPending = () => {
    if (!pending) return;
    const previous = pending;
    clearPending();
    dispatch('press', previous.captures);
    dispatch('release', previous.captures);
  };
  const cancelPending = () => clearPending();
  const deliverShort = (x: number, y: number, captures: Captured) => {
    const doubleTap = handlers.doubleTap ?? captures.doubleTap !== undefined;
    if (pending) {
      const previous = pending;
      clearPending();
      const within =
        Math.hypot(x - previous.x, y - previous.y) < 24 &&
        performance.now() - previous.time >= 0 &&
        performance.now() - previous.time <= DOUBLE_TAP;
      if (within && previous.doubleTap && doubleTap) {
        dispatch('doubleTap', captures);
        return;
      }
      dispatch('press', previous.captures);
      dispatch('release', previous.captures);
    }
    if (!doubleTap) {
      dispatch('press', captures);
      dispatch('release', captures);
      return;
    }
    const time = performance.now();
    pending = {
      x,
      y,
      time,
      captures,
      doubleTap,
      timer: setTimeout(() => {
        if (pending?.captures !== captures) return;
        pending = null;
        dispatch('press', captures);
        dispatch('release', captures);
      }, DOUBLE_TAP),
    };
  };

  const cancel = (pointerId?: number) => {
    if (active && (pointerId == null || pointerId === active.state.pointerId)) {
      clearHold(active);
      const snapshot = active.snapshot;
      active = null;
      handlers.onCancel?.(snapshot);
      handlers.onPull?.(null);
    }
    if (keyboard) {
      clearHold(keyboard);
      keyboard = null;
    }
    cancelPending();
  };
  const fireLong = (interaction: ActivePull | NonNullable<typeof keyboard>) => {
    if (interaction.longStarted) return;
    interaction.longStarted = true;
    clearHold(interaction);
    flushPending();
    dispatch('longPress', interaction.captures);
    if ('state' in interaction) handlers.onPull?.(null);
  };
  const down = (e: PointerEvent) => {
    if (handlers.enabled === false || e.button !== 0 || active || keyboard) return;
    const rect = node.getBoundingClientRect();
    const interactionId = makeInteractionId();
    const interaction: ActivePull = {
      state: beginPull(
        e.pointerId,
        e.clientX,
        e.clientY,
        performance.now(),
        rect.width,
        rect.height,
      ),
      bindings:
        typeof handlers.pullBindings === 'function'
          ? handlers.pullBindings()
          : (handlers.pullBindings ?? {}),
      snapshot: null,
      captures: capture(interactionId),
      interactionId,
      longStarted: false,
    };
    active = interaction;
    interaction.holdTimer = setTimeout(() => {
      if (active === interaction && !interaction.state.movedBeyondSlop) fireLong(interaction);
    }, HOLD_MS);
    node.setPointerCapture(e.pointerId);
    handlers.onStart?.();
  };
  const update = (e: PointerEvent) => {
    if (!active || e.pointerId !== active.state.pointerId) return active;
    const beforeSlop = active.state.movedBeyondSlop;
    const result = updatePull(active.state, e.clientX, e.clientY, active.bindings);
    active = { ...active, state: result.state, snapshot: result.snapshot };
    if (!beforeSlop && result.state.movedBeyondSlop) {
      clearHold(active);
      flushPending();
    }
    if (active.longStarted) handlers.onPull?.(null);
    else handlers.onPull?.(result.snapshot);
    return active;
  };
  const move = (e: PointerEvent) => {
    update(e);
  };
  const up = (e: PointerEvent) => {
    if (!active || e.pointerId !== active.state.pointerId) return;
    const latest = update(e)!;
    const { state, snapshot, captures, longStarted } = latest;
    clearHold(latest);
    active = null;
    if (longStarted || (!state.movedBeyondSlop && performance.now() - state.startTime >= HOLD_MS)) {
      if (!longStarted) fireLong(latest);
      dispatch('longPressRelease', captures);
      handlers.onPull?.(null);
      return;
    }
    if (state.movedBeyondSlop) {
      handlers.onPullEnd?.(snapshot, !!snapshot?.armed);
      if (snapshot?.armed) dispatch(snapshot.direction, captures, snapshot);
      handlers.onPull?.(null);
      return;
    }
    deliverShort(e.clientX, e.clientY, captures);
    handlers.onPull?.(null);
  };
  const lost = (e: PointerEvent) => cancel(e.pointerId);
  const keydown = (e: KeyboardEvent) => {
    if (
      handlers.enabled === false ||
      (e.key !== 'Enter' && e.key !== ' ') ||
      e.repeat ||
      active ||
      keyboard
    )
      return;
    e.preventDefault();
    suppressSyntheticClick = true;
    if (clickSuppressionTimer) clearTimeout(clickSuppressionTimer);
    clickSuppressionTimer = setTimeout(() => {
      suppressSyntheticClick = false;
    }, 1000);
    const interactionId = makeInteractionId();
    const interaction = {
      captures: capture(interactionId),
      interactionId,
      startedAt: performance.now(),
      longStarted: false,
      holdTimer: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    keyboard = interaction;
    interaction.holdTimer = setTimeout(() => {
      if (keyboard === interaction) fireLong(interaction);
    }, HOLD_MS);
  };
  const keyup = (e: KeyboardEvent) => {
    if (!keyboard || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    const interaction = keyboard;
    clearHold(interaction);
    keyboard = null;
    if (interaction.longStarted || performance.now() - interaction.startedAt >= HOLD_MS) {
      if (!interaction.longStarted) fireLong(interaction);
      dispatch('longPressRelease', interaction.captures);
    } else deliverShort(0, 0, interaction.captures);
    if (clickSuppressionTimer) clearTimeout(clickSuppressionTimer);
    clickSuppressionTimer = setTimeout(() => {
      suppressSyntheticClick = false;
    }, 0);
  };
  const click = (e: MouseEvent) => {
    if (
      handlers.enabled === false ||
      e.detail !== 0 ||
      suppressSyntheticClick ||
      active ||
      keyboard
    )
      return;
    const interactionId = makeInteractionId();
    deliverShort(e.clientX, e.clientY, capture(interactionId));
  };
  const blur = () => cancel();

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', lost);
  node.addEventListener('lostpointercapture', lost);
  node.addEventListener('keydown', keydown);
  node.addEventListener('keyup', keyup);
  node.addEventListener('click', click);
  node.addEventListener('blur', blur);
  const browserWindow = typeof window === 'undefined' ? undefined : window;
  browserWindow?.addEventListener('blur', blur);
  return {
    update: (next: GestureHandlers) => {
      handlers = next;
      if (handlers.enabled === false) cancel();
    },
    destroy() {
      cancel();
      if (clickSuppressionTimer) clearTimeout(clickSuppressionTimer);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', lost);
      node.removeEventListener('lostpointercapture', lost);
      node.removeEventListener('keydown', keydown);
      node.removeEventListener('keyup', keyup);
      node.removeEventListener('click', click);
      node.removeEventListener('blur', blur);
      browserWindow?.removeEventListener('blur', blur);
      handlers.onPull?.(null);
    },
  };
}

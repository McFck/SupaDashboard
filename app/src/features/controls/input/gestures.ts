// DOM adapter for tappable controls: pointer, keyboard and assistive clicks feed one press machine, and a pointer
// press also tracks a directional pull. Pull and tap decisions happen only after cancellation checks.
import { captureTriggers, PressMachine, type Captures } from './press';
import {
  beginPull,
  updatePull,
  type PullBindings,
  type PullSnapshot,
  type PullState,
} from './pull';
import type { Trigger } from '../../automation/scenario';
import { untrack } from 'svelte';

type Pointer = {
  state: PullState;
  bindings: PullBindings;
  snapshot: PullSnapshot | null;
  captures: Captures;
};
/** Tile press feedback (PressFeedback), told when a pointer press starts and how it ends. */
export type PressFeedbackHandle = { start(event: PointerEvent): void; end(tapped: boolean): void };
export type GestureEffectHandlers = {
  onEffectPoint?: (point: { x: number; y: number }) => void;
  onEffectHold?: (captured: unknown) => void;
  onEffectEnd?: () => void;
};
type GestureHandlers = GestureEffectHandlers & {
  onTrigger: (trigger: Trigger, captured?: unknown, snapshot?: PullSnapshot) => void;
  captureTrigger?: (trigger: Trigger, interactionId: string) => unknown;
  enabled?: boolean;
  /** Current pull preview. This never runs a bound action or changes a variant. */
  onPull?: (pull: PullSnapshot | null) => void;
  /** Called once on pointerup after slop, including blocked and unarmed releases. */
  onPullEnd?: (snapshot: PullSnapshot | null) => void;
  /** Called for cancellation/lost capture, never for a commit. */
  onCancel?: (snapshot: PullSnapshot | null) => void;
  /** Direction bindings are captured at pointerdown so an active pull cannot change meaning. */
  pullBindings?: () => PullBindings;
  onStart?: () => void;
  feedback?: PressFeedbackHandle;
};

const isActivationKey = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ';

/** Pointer action with hold-time and paired short triggers, captured settings, and one release decision. */
export function gestures(node: HTMLElement, initial: GestureHandlers) {
  let handlers = initial;
  let pointer: Pointer | null = null;
  let keyboard: Captures | null = null;

  const dispatch = (trigger: Trigger, captures: Captures, snapshot?: PullSnapshot) => {
    handlers.onTrigger(trigger, captures[trigger], snapshot);
  };
  const press = new PressMachine({
    trigger: (trigger, captures) => {
      if (trigger === 'longPress') {
        handlers.onEffectHold?.(captures[trigger]);
      }
      dispatch(trigger, captures);
      if (trigger === 'longPress' && pointer) {
        handlers.onPull?.(null);
      }
    },
    tap: ({ captures }) => {
      dispatch('press', captures);
      dispatch('release', captures);
    },
  });

  const cancel = (pointerId?: number) => {
    // Capture is also lost right after every pointerup; that must not drop a tap waiting for its pair.
    if (pointerId != null && pointerId !== pointer?.state.pointerId) {
      return;
    }
    press.cancel();
    handlers.onEffectEnd?.();
    keyboard = null;
    if (pointer) {
      const snapshot = pointer.snapshot;
      pointer = null;
      handlers.feedback?.end(false);
      handlers.onCancel?.(snapshot);
      handlers.onPull?.(null);
    }
  };
  const down = (e: PointerEvent) => {
    if (handlers.enabled === false || e.button !== 0 || pointer || keyboard) {
      return;
    }
    const rect = node.getBoundingClientRect();
    handlers.onEffectPoint?.({
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    });
    const { pullBindings } = handlers;
    pointer = {
      state: beginPull(e.pointerId, e.clientX, e.clientY, rect.width, rect.height),
      bindings: pullBindings?.() ?? {},
      snapshot: null,
      captures: captureTriggers(handlers.captureTrigger),
    };
    press.start(pointer.captures);
    handlers.feedback?.start(e);
    node.setPointerCapture(e.pointerId);
    handlers.onStart?.();
  };
  const move = (e: PointerEvent) => {
    if (!pointer || e.pointerId !== pointer.state.pointerId) {
      return;
    }
    const result = updatePull(pointer.state, e.clientX, e.clientY, pointer.bindings);
    pointer.state = result.state;
    pointer.snapshot = result.snapshot;
    if (result.state.movedBeyondSlop) {
      press.move();
      handlers.feedback?.end(false);
    }
    handlers.onPull?.(press.long ? null : result.snapshot);
    if (!press.long) {
      if (result.snapshot?.armed) {
        handlers.onEffectHold?.(pointer.captures[result.snapshot.direction]);
      } else {
        handlers.onEffectEnd?.();
      }
    }
  };
  const up = (e: PointerEvent) => {
    if (!pointer || e.pointerId !== pointer.state.pointerId) {
      return;
    }
    move(e);
    handlers.feedback?.end(true);
    const { snapshot, captures } = pointer;
    pointer = null;
    if (press.end({ x: e.clientX, y: e.clientY, captures }) === 'moved') {
      handlers.onPullEnd?.(snapshot);
      if (snapshot?.armed) {
        dispatch(snapshot.direction, captures, snapshot);
      }
    }
    handlers.onPull?.(null);
    handlers.onEffectEnd?.();
  };
  const lost = (e: PointerEvent) => cancel(e.pointerId);
  const keydown = (e: KeyboardEvent) => {
    if (handlers.enabled === false || !isActivationKey(e) || e.repeat || pointer || keyboard) {
      return;
    }
    e.preventDefault();
    handlers.onEffectPoint?.({ x: 0.5, y: 0.5 });
    keyboard = captureTriggers(handlers.captureTrigger);
    press.start(keyboard);
  };
  const keyup = (e: KeyboardEvent) => {
    if (!keyboard || !isActivationKey(e)) {
      return;
    }
    e.preventDefault();
    const captures = keyboard;
    keyboard = null;
    press.end({ x: 0, y: 0, captures });
    handlers.onEffectEnd?.();
  };
  // Assistive technology activates with a click that has no pointer sequence (detail 0).
  const click = (e: MouseEvent) => {
    if (handlers.enabled === false || e.detail !== 0 || pointer || keyboard) {
      return;
    }
    handlers.onEffectPoint?.({ x: 0.5, y: 0.5 });
    press.tap({ x: e.clientX, y: e.clientY, captures: captureTriggers(handlers.captureTrigger) });
  };
  // Removing a focused tile fires blur inside Svelte's DOM reconciliation.
  const blur = () => untrack(() => cancel());

  const listeners = new AbortController();
  const { signal } = listeners;
  node.addEventListener('pointerdown', down, { signal });
  node.addEventListener('pointermove', move, { signal });
  node.addEventListener('pointerup', up, { signal });
  node.addEventListener('pointercancel', lost, { signal });
  node.addEventListener('lostpointercapture', lost, { signal });
  node.addEventListener('keydown', keydown, { signal });
  node.addEventListener('keyup', keyup, { signal });
  node.addEventListener('click', click, { signal });
  node.addEventListener('blur', blur, { signal });
  if (typeof window !== 'undefined') {
    window.addEventListener('blur', blur, { signal });
  }
  return {
    update: (next: GestureHandlers) => {
      handlers = next;
      if (handlers.enabled === false) {
        untrack(() => cancel());
      }
    },
    destroy() {
      untrack(() => {
        cancel();
        listeners.abort();
        handlers.onPull?.(null);
      });
    },
  };
}

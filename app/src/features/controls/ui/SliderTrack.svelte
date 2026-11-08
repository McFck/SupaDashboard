<script lang="ts">
  // A pill-shaped level control. Its long axis controls the value; only eligible cross-axis pulls change content.
  import type { Component } from 'svelte';
  import {
    beginPull,
    type PullAxis,
    type PullBindings,
    type PullSnapshot,
    type PullState,
    updatePull,
  } from '../input/pull';
  import type { ControlFaceProps, TilePresentation } from '../model';
  import { captureTriggers, PressMachine, type Captures, type Tap } from '../input/press';
  import type { PressFeedbackHandle, GestureEffectHandlers } from '../input/gestures';
  import type { Trigger } from '../../automation/scenario';
  import { onDestroy, tick, untrack } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import SliderFace from './SliderFace.svelte';
  import StateView from './StateView.svelte';
  import { sliderFaceText } from '../face-layout';

  type ActiveDrag = {
    state: PullState;
    rect: DOMRectReadOnly;
    vertical: boolean;
    bindings: PullBindings;
    snapshot: PullSnapshot | null;
    lastValue: number | null;
    captures: Captures;
  };
  let {
    level,
    muted = false,
    vertical = true,
    pullBindings = {},
    sourceKey = '',
    accent = '#e4e4e7',
    icon,
    label,
    presentation,
    presentationImmediate = false,
    face: Face = SliderFace,
    stateId = 'state-1',
    stateIndex = 0,
    busy = false,
    pull = null,
    compact = false,
    pixelWidth = 0,
    pixelHeight = 0,
    onchange,
    onmute,
    onpull,
    onpullstart,
    onpullend,
    oncancel,
    capturetrigger,
    ontrigger,
    feedback,
    gestureEffects,
  }: {
    level: number | null;
    muted?: boolean;
    vertical?: boolean;
    pullBindings?: PullBindings;
    sourceKey?: string;
    accent?: string;
    icon?: string;
    label?: string;
    presentation?: TilePresentation;
    presentationImmediate?: boolean;
    face?: Component<ControlFaceProps>;
    stateId?: string;
    stateIndex?: number;
    busy?: boolean;
    pull?: PullSnapshot | null;
    compact?: boolean;
    pixelWidth?: number;
    pixelHeight?: number;
    onchange: (v: number) => void;
    onmute?: () => void;
    onpull?: (p: PullSnapshot | null) => void;
    onpullstart?: () => void;
    onpullend?: (p: PullSnapshot | null, armed: boolean) => void;
    oncancel?: (p: PullSnapshot | null) => void;
    capturetrigger?: (trigger: Trigger, interactionId: string) => unknown;
    ontrigger?: (trigger: Trigger, captured?: unknown, snapshot?: PullSnapshot) => void;
    feedback?: PressFeedbackHandle;
    gestureEffects?: GestureEffectHandlers;
  } = $props();

  let el = $state<HTMLElement>();
  let width = $state(0),
    height = $state(0);
  let drag: ActiveDrag | null = null;
  let active = $state(false);
  let fillReady = $state(false);
  let previousLevel: number | null = null;
  let previousSourceKey: string | undefined;
  let previousVertical: boolean | undefined;
  let readinessGeneration = 0,
    frameA = 0,
    frameB = 0;
  let readinessPending = false;

  function cancelReadiness() {
    readinessGeneration++;
    if (frameA) cancelAnimationFrame(frameA);
    if (frameB) cancelAnimationFrame(frameB);
    frameA = frameB = 0;
    readinessPending = false;
  }
  async function enableReadiness() {
    if (readinessPending) return;
    readinessPending = true;
    const generation = readinessGeneration;
    await tick();
    if (generation !== readinessGeneration) return;
    frameA = requestAnimationFrame(() => {
      frameB = requestAnimationFrame(() => {
        if (generation !== readinessGeneration) return;
        fillReady = true;
        readinessPending = false;
        frameA = frameB = 0;
      });
    });
  }

  // Runs before the DOM update, so a new source or orientation never animates the fill from the old level.
  $effect.pre(() => {
    const value = level,
      source = sourceKey,
      orientation = vertical;
    const identityChanged = previousSourceKey !== source || previousVertical !== orientation;
    if (identityChanged || value == null) {
      fillReady = false;
      cancelReadiness();
    }
    if (value != null && (identityChanged || previousLevel == null || !untrack(() => fillReady))) {
      void enableReadiness();
    }
    previousSourceKey = source;
    previousVertical = orientation;
    previousLevel = value;
  });

  const fromPointer = (
    point: { clientX: number; clientY: number },
    rect: DOMRectReadOnly,
    isVertical: boolean,
  ) => {
    const v = isVertical
      ? (rect.bottom - point.clientY) / rect.height
      : (point.clientX - rect.left) / rect.width;
    return Math.min(1, Math.max(0, v));
  };
  const valueAxis = (isVertical: boolean): PullAxis => (isVertical ? 'y' : 'x');

  // A short press sets the value where it landed (or mutes on the icon); it can pair into a double tap.
  const press = new PressMachine<Tap & { rect: DOMRectReadOnly }>({
    trigger: (trigger, captures) => {
      if (trigger === 'longPress') {
        gestureEffects?.onEffectHold?.(captures[trigger]);
      }
      ontrigger?.(trigger, captures[trigger]);
    },
    tap: ({ x, y, rect }) => {
      const onIcon = vertical
        ? y > rect.bottom - Math.min(rect.width, 48)
        : x < rect.left + Math.min(rect.height, 48);
      if (onIcon && onmute) {
        onmute();
      } else if (level != null) {
        onchange(fromPointer({ clientX: x, clientY: y }, rect, vertical));
      }
    },
  });

  function down(e: PointerEvent) {
    if (e.button !== 0 || drag || !el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    gestureEffects?.onEffectPoint?.({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
    drag = {
      state: beginPull(e.pointerId, e.clientX, e.clientY, rect.width, rect.height),
      rect,
      vertical,
      bindings: { ...pullBindings },
      snapshot: null,
      lastValue: level,
      captures: captureTriggers(capturetrigger),
    };
    press.start(drag.captures);
    feedback?.start(e);
    el.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.state.pointerId) {
      return;
    }
    const previousAxis = drag.state.lockedAxis;
    const result = updatePull(drag.state, e.clientX, e.clientY, drag.bindings);
    const axis = result.state.lockedAxis;
    drag.state = result.state;
    drag.snapshot = result.snapshot;
    if (result.state.movedBeyondSlop) {
      press.move();
      feedback?.end(false);
    }
    if (press.long) {
      onpull?.(null);
      return;
    }
    if (axis && axis !== valueAxis(drag.vertical) && previousAxis == null) {
      onpullstart?.();
    }
    if (axis === valueAxis(drag.vertical) && result.state.movedBeyondSlop) {
      active = true;
      if (level != null) {
        const next = fromPointer(e, drag.rect, drag.vertical);
        if (next !== drag.lastValue) {
          drag.lastValue = next;
          onchange(next);
        }
      }
      onpull?.(null);
    } else {
      active = false;
      onpull?.(axis ? result.snapshot : null);
      if (result.snapshot?.armed) {
        gestureEffects?.onEffectHold?.(drag.captures[result.snapshot.direction]);
      } else {
        gestureEffects?.onEffectEnd?.();
      }
    }
  }
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.state.pointerId) {
      return;
    }
    move(e);
    feedback?.end(true);
    const finished = drag;
    drag = null;
    active = false;
    const outcome = press.end({
      x: e.clientX,
      y: e.clientY,
      captures: finished.captures,
      rect: finished.rect,
    });
    const { snapshot } = finished;
    if (outcome === 'moved' && finished.state.lockedAxis !== valueAxis(finished.vertical)) {
      onpullend?.(snapshot, !!snapshot?.armed);
      if (snapshot?.armed) {
        ontrigger?.(snapshot.direction, finished.captures[snapshot.direction], snapshot);
      }
    }
    onpull?.(null);
    gestureEffects?.onEffectEnd?.();
  }
  function cancel(pointerId?: number) {
    if (!drag || (pointerId != null && pointerId !== drag.state.pointerId)) {
      return;
    }
    const finished = drag;
    drag = null;
    active = false;
    press.cancel();
    gestureEffects?.onEffectEnd?.();
    feedback?.end(false);
    if (finished.state.lockedAxis !== valueAxis(finished.vertical)) {
      oncancel?.(finished.snapshot);
    }
    onpull?.(null);
  }

  $effect(() => {
    const orientation = vertical;
    if (drag && drag.vertical !== orientation) cancel(drag.state.pointerId);
  });
  onDestroy(() => {
    gestureEffects?.onEffectEnd?.();
    press.cancel();
    drag = null;
    cancelReadiness();
  });
  function key(e: KeyboardEvent) {
    const step = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[e.key];
    if (step == null || level == null) return;
    e.preventDefault();
    onchange(Math.min(1, Math.max(0, level + step)));
  }
  const pct = $derived(level == null ? null : Math.round(level * 100));
  const appearance = $derived(
    presentation ?? {
      key: `source:${sourceKey}`,
      view: { label: label ?? '', icon, color: accent },
    },
  );
  const faceText = $derived(sliderFaceText(width || pixelWidth, height || pixelHeight, vertical));
  const animateFill = $derived(
    fillReady && Number.isFinite(level) && !active && !prefersReducedMotion.current,
  );
</script>

<div
  bind:this={el}
  bind:clientWidth={width}
  bind:clientHeight={height}
  data-dashboard-tile
  data-slider-track
  data-face-hide-name={!faceText.name}
  data-face-hide-percent={!faceText.percentage}
  data-face-icon-only={!faceText.name && !faceText.percentage}
  style:--track-radius="{Math.min(18, (width || pixelWidth) * 0.2)}px"
  role="slider"
  tabindex="0"
  aria-label={label}
  aria-valuenow={pct ?? undefined}
  aria-orientation={vertical ? 'vertical' : 'horizontal'}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onkeydown={key}
  onpointercancel={(e) => cancel(e.pointerId)}
  onlostpointercapture={(e) => cancel(e.pointerId)}
  class="relative h-full w-full touch-none select-none overflow-hidden rounded-[var(--track-radius,18px)] outline-none
    ring-white/30 transition-[box-shadow] focus-visible:ring-2 {active
    ? 'ring-2 ring-white/20'
    : ''} {level == null ? 'opacity-40' : ''}"
>
  <div class="pointer-events-none absolute inset-0">
    <StateView
      presentation={appearance}
      immediate={presentationImmediate}
      class="h-full w-full"
    >
      {#snippet children(view)}
        <Face
          appearance={view}
          presentation={appearance}
          {stateId}
          {stateIndex}
          {busy}
          {pull}
          {compact}
          {pixelWidth}
          {pixelHeight}
          slider={{
            level,
            muted,
            orientation: vertical ? 'vertical' : 'horizontal',
            active,
            fillReady,
            animateFill,
            sourceKey,
            accent,
          }}
        />
      {/snippet}
    </StateView>
  </div>
</div>

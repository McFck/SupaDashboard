<script lang="ts">
  // A pill-shaped level control. Its long axis controls the value; only eligible cross-axis pulls change content.
  import type { Component } from 'svelte';
  import { beginPull, classify, shouldAnimateSliderFill, type Gesture, type PullAxis, type PullBindings, type PullSnapshot,
    type ControlFaceProps, type PullState, type TilePresentation, updatePull } from '../core/controls';
  import { tapSequence } from '../core/gestures';
  import { TRIGGERS, type Trigger } from '../core/scenario';
  import { onDestroy, onMount, tick } from 'svelte';
  import SliderFace from './SliderFace.svelte';
  import StateView from './StateView.svelte';
  import { sliderFaceText } from './face-layout';

  type TrackRect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
  type ActiveDrag = { state: PullState; rect: TrackRect; vertical: boolean; bindings: PullBindings;
    snapshot: PullSnapshot | null; lastValue: number | null; captures: Partial<Record<Trigger, unknown>>;
    longStarted: boolean; holdTimer?: ReturnType<typeof setTimeout> };
  let { level, muted = false, vertical = true, pullBindings = {}, sourceKey = '', accent = '#e4e4e7', icon, label,
    presentation, presentationImmediate = false, doubleTap = false, face = SliderFace, stateId = 'state-1', stateIndex = 0,
    busy = false, pull = null, compact = false, pixelWidth = 0, pixelHeight = 0,
    onchange, onmute, onpull, onpullstart, onpullend, oncancel, ongesture, capturetrigger, ontrigger }: {
    level: number | null; muted?: boolean; vertical?: boolean; pullBindings?: PullBindings; sourceKey?: string; accent?: string; icon?: string; label?: string;
    presentation?: TilePresentation; presentationImmediate?: boolean;
    face?: Component<ControlFaceProps>; stateId?: string; stateIndex?: number; busy?: boolean; pull?: PullSnapshot | null;
    compact?: boolean; pixelWidth?: number; pixelHeight?: number;
    doubleTap?: boolean; onchange: (v: number) => void; onmute?: () => void;
    onpull?: (p: PullSnapshot | null) => void; onpullstart?: () => void;
    onpullend?: (p: PullSnapshot | null, armed: boolean) => void;
    oncancel?: (p: PullSnapshot | null) => void; ongesture?: (g: Gesture, snapshot?: PullSnapshot) => void;
    capturetrigger?: (trigger: Trigger, interactionId: string) => unknown;
    ontrigger?: (trigger: Trigger, captured?: unknown, snapshot?: PullSnapshot) => void;
  } = $props();

  let el = $state<HTMLElement>();
  let width = $state(0), height = $state(0);
  let drag: ActiveDrag | null = null;
  let active = $state(false);
  let lastTapRect: TrackRect | null = null;
  let fillReady = $state(false);
  let reducedMotion = $state(false);
  let previousLevel = $state<number | null>(null);
  let previousSourceKey = $state<string | undefined>();
  let previousVertical = $state<boolean | undefined>();
  let readinessGeneration = 0, frameA = 0, frameB = 0;
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

  $effect(() => {
    const value = level, source = sourceKey, orientation = vertical;
    const identityChanged = previousSourceKey !== source || previousVertical !== orientation;
    if (identityChanged || value == null) {
      fillReady = false;
      cancelReadiness();
    }
    if (value != null && (identityChanged || previousLevel == null || !fillReady)) void enableReadiness();
    previousSourceKey = source;
    previousVertical = orientation;
    previousLevel = value;
  });

  onMount(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reducedMotion = media.matches; };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });

  const rectNow = (): TrackRect => {
    const r = el!.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const fromPointer = (point: { clientX: number; clientY: number }, rect: TrackRect, isVertical: boolean) => {
    const v = isVertical ? (rect.bottom - point.clientY) / rect.height : (point.clientX - rect.left) / rect.width;
    return Math.min(1, Math.max(0, v));
  };
  const valueAxis = (isVertical: boolean): PullAxis => isVertical ? 'y' : 'x';

  function down(e: PointerEvent) {
    if (e.button !== 0 || drag) return;
    const rect = rectNow();
    const interactionId = globalThis.crypto?.randomUUID?.() ?? `slider-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const captures: Partial<Record<Trigger, unknown>> = {};
    for (const trigger of TRIGGERS) captures[trigger] = capturetrigger?.(trigger, interactionId);
    drag = { state: beginPull(e.pointerId, e.clientX, e.clientY, performance.now(), rect.width, rect.height),
      rect, vertical, bindings: { ...pullBindings }, snapshot: null, lastValue: level, captures, longStarted: false };
    const interaction = drag;
    interaction.holdTimer = setTimeout(() => {
      if (drag === interaction && !interaction.state.movedBeyondSlop) {
        interaction.longStarted = true;
        ontrigger?.('longPress', interaction.captures.longPress);
      }
    }, 550);
    el!.setPointerCapture(e.pointerId);
  }
  function update(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.state.pointerId) return;
    const beforeSlop = drag.state.movedBeyondSlop;
    const previousAxis = drag.state.lockedAxis;
    const result = updatePull(drag.state, e.clientX, e.clientY, drag.bindings);
    const axis = result.state.lockedAxis;
    if (!beforeSlop && result.state.movedBeyondSlop && drag.holdTimer) clearTimeout(drag.holdTimer);
    drag = { ...drag, state: result.state, snapshot: result.snapshot };
    if (drag.longStarted) { onpull?.(null); return; }
    if (axis && axis !== valueAxis(drag.vertical) && previousAxis == null) onpullstart?.();
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
    }
  }
  function move(e: PointerEvent) { update(e); }
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.state.pointerId) return;
    update(e);
    if (!drag || e.pointerId !== drag.state.pointerId) return;
    const finished = drag;
    drag = null;
    active = false;
    if (finished.holdTimer) clearTimeout(finished.holdTimer);
    if (finished.longStarted || (!finished.state.movedBeyondSlop && performance.now() - finished.state.startTime >= 550)) {
      if (!finished.longStarted) ontrigger?.('longPress', finished.captures.longPress);
      ontrigger?.('longPressRelease', finished.captures.longPressRelease);
      onpull?.(null);
      return;
    }
    if (finished.state.movedBeyondSlop) {
      if (finished.state.lockedAxis !== valueAxis(finished.vertical)) {
        onpullend?.(finished.snapshot, !!finished.snapshot?.armed);
        if (finished.snapshot?.armed) {
          if (ontrigger) ontrigger(finished.snapshot.direction, finished.captures[finished.snapshot.direction], finished.snapshot);
          else ongesture?.(finished.snapshot.direction, finished.snapshot);
        }
      }
      onpull?.(null);
      return;
    }
    lastTapRect = finished.rect;
    const gesture = classify(0, 0, performance.now() - finished.state.startTime);
    taps.send(gesture, e.clientX, e.clientY, doubleTap, finished.captures);
    onpull?.(null);
  }
  function cancel(pointerId?: number) {
    if (!drag || (pointerId != null && pointerId !== drag.state.pointerId)) return;
    const finished = drag;
    drag = null;
    active = false;
    if (finished.holdTimer) clearTimeout(finished.holdTimer);
    if (finished.state.lockedAxis !== valueAxis(finished.vertical)) oncancel?.(finished.snapshot);
    onpull?.(null);
    taps.cancel();
  }

  const taps = tapSequence((g, x, y, captured) => {
    const captures = captured as Partial<Record<Trigger, unknown>> | undefined;
    if (g === 'doubleTap' && ontrigger) {
      ontrigger('doubleTap', captures?.doubleTap);
      return;
    }
    if (g === 'tap') {
      const r = lastTapRect;
      if (!r) return;
      const onIcon = vertical ? y > r.bottom - Math.min(r.width, 48) : x < r.left + Math.min(r.height, 48);
      if (onIcon && onmute) return onmute();
      if (level != null) return onchange(fromPointer({ clientX: x, clientY: y }, r, vertical));
    }
    ongesture?.(g);
  });
  $effect(() => {
    const orientation = vertical;
    if (drag && drag.vertical !== orientation) cancel(drag.state.pointerId);
  });
  onDestroy(() => { taps.cancel(); if (drag?.holdTimer) clearTimeout(drag.holdTimer); drag = null; cancelReadiness(); });
  function key(e: KeyboardEvent) {
    const step = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[e.key];
    if (step == null || level == null) return;
    e.preventDefault();
    onchange(Math.min(1, Math.max(0, level + step)));
  }
  const pct = $derived(level == null ? null : Math.round(level * 100));
  const appearance = $derived(presentation ?? { key: `source:${sourceKey}`, view: { label: label ?? '', icon, color: accent } });
  const Face = $derived(face ?? SliderFace);
  const faceText = $derived(sliderFaceText(width || pixelWidth, height || pixelHeight, vertical));
  const animateFill = $derived(shouldAnimateSliderFill({ level, previousLevel, sourceKey, previousSourceKey: previousSourceKey ?? '',
    vertical, previousVertical: previousVertical ?? vertical, ready: fillReady, dragging: active, reducedMotion }));
</script>

<div bind:this={el} bind:clientWidth={width} bind:clientHeight={height} data-dashboard-tile data-slider-track
  data-face-hide-name={!faceText.name} data-face-hide-percent={!faceText.percentage}
  data-face-icon-only={!faceText.name && !faceText.percentage} style:--track-radius="{Math.min(18, (width || pixelWidth) * .2)}px"
  role="slider" tabindex="0" aria-label={label} aria-valuenow={pct ?? undefined}
  aria-orientation={vertical ? 'vertical' : 'horizontal'}
  onpointerdown={down} onpointermove={move} onpointerup={up} onkeydown={key}
  onpointercancel={e => cancel(e.pointerId)} onlostpointercapture={e => cancel(e.pointerId)}
  class="relative h-full w-full touch-none select-none overflow-hidden rounded-[var(--track-radius,18px)] outline-none
    ring-white/30 transition-[box-shadow] focus-visible:ring-2 {active ? 'ring-2 ring-white/20' : ''} {level == null ? 'opacity-40' : ''}">
  <div class="pointer-events-none absolute inset-0">
    <StateView presentation={appearance} immediate={presentationImmediate} class="h-full w-full">
      {#snippet children(view)}
        <Face appearance={view} presentation={appearance} {stateId} {stateIndex} {busy} {pull} {compact} {pixelWidth} {pixelHeight}
          slider={{ level, muted, orientation: vertical ? 'vertical' : 'horizontal', active, fillReady, animateFill, sourceKey, accent }} />
      {/snippet}
    </StateView>
  </div>
</div>

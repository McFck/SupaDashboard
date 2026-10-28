<script lang="ts">
  import { onDestroy, tick, type Snippet } from 'svelte';
  import type { PullSnapshot } from '../input/pull';
  import { springDuration, SPRING_SAMPLES } from '$lib/spring';
  import type { ControlConfig, Variant } from '../model';

  let {
    control,
    current,
    pull,
    children,
  }: {
    control: ControlConfig;
    current: number;
    pull: PullSnapshot | null;
    children: Snippet<[Variant, boolean, boolean]>;
  } = $props();
  type Pose = { x: number; y: number; opacity: number; scale?: number };
  const MORPH_SCALE = 0.6;
  type Held = {
    snapshot: PullSnapshot;
    sourceIndex: number;
    targetIndex: number | null;
    committed: boolean;
  };
  let outgoing = $state<HTMLElement>(),
    incoming = $state<HTMLElement>(),
    pulse = $state<HTMLElement>();
  let held = $state<Held | null>(null),
    settling = $state(false);
  let basePose = $state<Pose>({ x: 0, y: 0, opacity: 1 });
  let generation = 0;
  let animations: Animation[] = [];

  const snapshot = $derived(settling ? (held?.snapshot ?? null) : pull);
  const sourceIndex = $derived(settling && held ? held.sourceIndex : current);
  const targetIndex = $derived(
    settling && held
      ? held.targetIndex
      : snapshot?.effect.kind === 'variant'
        ? snapshot.effect.variant
        : null,
  );
  const target = $derived(targetIndex == null ? null : control.variants[targetIndex]);
  const handoff = $derived(
    target && snapshot && (!settling || held?.committed) ? handoffOf(snapshot) : 0,
  );
  const x = $derived(basePose.x + (snapshot?.axis === 'x' ? snapshot.offset : 0));
  const y = $derived(basePose.y + (snapshot?.axis === 'y' ? snapshot.offset : 0));
  const translation = $derived(`translate(${x}px, ${y}px)`);
  const outgoingOpacity = $derived(basePose.opacity * (target ? 1 - handoff : 1));
  const incomingOpacity = $derived(basePose.opacity * handoff);
  // Stays on for a frame after a pull settles so the state view adopts the new face without a second crossfade.
  let adopting = $state(false);
  const transitionDisabled = $derived(settling || !!pull || adopting);

  /** A state pull hands the face over to the target state once armed; a scenario pull never does. */
  function handoffOf(snapshot: PullSnapshot) {
    return snapshot.effect.kind === 'variant' && snapshot.armed ? 1 : 0;
  }
  function stop() {
    for (const animation of animations) animation.cancel();
    animations = [];
  }
  function poseOf(element: HTMLElement | undefined): Pose {
    if (!element) return { x: 0, y: 0, opacity: 1 };
    const style = getComputedStyle(element);
    const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    const opacity = Number.parseFloat(style.opacity);
    const scale = Number.parseFloat(style.scale);
    return {
      x: matrix.m41,
      y: matrix.m42,
      opacity: Number.isFinite(opacity) ? opacity : 1,
      scale: Number.isFinite(scale) ? scale : 1,
    };
  }
  function reducedMotion() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function springFrames(from: Pose, to: Pose) {
    return SPRING_SAMPLES.map(({ offset, progress }) => ({
      offset,
      transform: `translate(${from.x + (to.x - from.x) * progress}px, ${from.y + (to.y - from.y) * progress}px)`,
      opacity: Math.max(0, Math.min(1, from.opacity + (to.opacity - from.opacity) * offset)),
      scale: String((from.scale ?? 1) + ((to.scale ?? 1) - (from.scale ?? 1)) * progress),
    }));
  }
  function animate(element: HTMLElement | undefined, from: Pose, to: Pose, duration: number) {
    if (!element || duration <= 0) return;
    animations.push(
      element.animate(springFrames(from, to), { duration, easing: 'linear', fill: 'forwards' }),
    );
  }

  /** Interrupt a settling transition at its rendered pose before a new pointer sequence starts. */
  export function beginPull() {
    if (!settling || !held) return;
    const promoteIncoming = held.committed && held.targetIndex != null;
    const pose = poseOf(promoteIncoming ? incoming : outgoing);
    generation++;
    stop();
    held = null;
    settling = false;
    basePose = pose;
  }

  /** Commit an armed pull synchronously, then settle frozen content to the committed state. */
  export async function release(finalPull: PullSnapshot, commit?: () => void) {
    const run = ++generation;
    stop();
    const targetVariant = finalPull.effect.kind === 'variant' ? finalPull.effect.variant : null;
    const committed = !!commit && finalPull.armed;
    const base = { ...basePose };
    held = { snapshot: finalPull, sourceIndex: current, targetIndex: targetVariant, committed };
    settling = true;
    if (committed) commit();
    const duration = reducedMotion() ? 0 : springDuration(Math.abs(finalPull.offset));
    await tick();
    if (run !== generation || !outgoing) return;

    const from = {
      x: base.x + (finalPull.axis === 'x' ? finalPull.offset : 0),
      y: base.y + (finalPull.axis === 'y' ? finalPull.offset : 0),
      opacity: base.opacity * (targetVariant == null || !committed ? 1 : 1 - handoffOf(finalPull)),
    };
    const nextFrom = {
      ...from,
      opacity: base.opacity * (committed ? handoffOf(finalPull) : 0),
    };
    const center = { x: 0, y: 0, opacity: 1 };
    if (committed && targetVariant != null) {
      // Finish the morph from wherever the crossfade was when the finger lifted.
      const out = poseOf(outgoing),
        inn = poseOf(incoming);
      animate(
        outgoing,
        { ...from, opacity: out.opacity, scale: out.scale },
        { ...center, opacity: 0, scale: MORPH_SCALE },
        duration,
      );
      animate(incoming, { ...nextFrom, opacity: inn.opacity, scale: inn.scale }, center, duration);
    } else {
      animate(outgoing, from, center, duration);
      if (targetVariant != null && incoming)
        animate(incoming, nextFrom, { ...center, opacity: 0 }, duration);
    }
    if (committed && pulse && duration > 0) {
      animations.push(
        pulse.animate([{ opacity: 0 }, { opacity: 0.3, offset: 0.18 }, { opacity: 0 }], {
          duration: 180,
        }),
      );
    }
    await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
    if (run !== generation) return;
    adopting = true;
    held = null;
    settling = false;
    basePose = { x: 0, y: 0, opacity: 1 };
    stop();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        adopting = false;
      }),
    );
  }

  export function cancelPull(finalPull: PullSnapshot | null) {
    if (finalPull) void release(finalPull);
  }
  onDestroy(() => {
    generation++;
    stop();
  });
</script>

<div
  data-dashboard-tile
  class="widget-content relative h-full w-full overflow-hidden rounded-[inherit]"
>
  <div
    bind:this={outgoing}
    data-dashboard-tile
    class="pull-layer absolute inset-0"
    class:settled={settling || adopting}
    style:transform={translation}
    style:opacity={outgoingOpacity}
    style:scale={target && handoff > 0 ? MORPH_SCALE : 1}
  >
    {@render children(
      control.variants[sourceIndex] ?? control.variants[0],
      true,
      transitionDisabled,
    )}
  </div>
  {#if target}
    <div
      bind:this={incoming}
      inert
      class="pull-layer pointer-events-none absolute inset-0"
      class:settled={settling || adopting}
      aria-hidden="true"
      style:transform={translation}
      style:opacity={incomingOpacity}
      style:scale={handoff > 0 ? 1 : MORPH_SCALE}
    >
      {@render children(target, false, true)}
    </div>
  {/if}
  <span
    bind:this={pulse}
    class="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0"
    style:background="var(--accent)"
  ></span>
</div>

<style>
  /* Icons morph between states: opacity and scale ease while translation follows the finger every frame. */
  .pull-layer {
    transition:
      opacity 160ms ease-out,
      scale 220ms cubic-bezier(0.34, 1.4, 0.64, 1);
  }
  .pull-layer.settled {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .pull-layer {
      transition: none;
    }
  }
</style>

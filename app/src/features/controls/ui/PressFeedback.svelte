<script lang="ts">
  // Press feedback for a tile: a ripple from the press point and a tap pulse. The control's press machine drives it
  // through start/end, so feedback and actions share one slop and one notion of a tap.
  import { onDestroy, type Snippet } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';

  let {
    disabled = false,
    class: surfaceClass = '',
    children,
  }: { disabled?: boolean; class?: string; children: Snippet } = $props();
  type Ripple = { x: number; y: number; diameter: number; key: number };
  /** Pointer-local ripple bounds corrected for a uniform scale around the tile center. */
  function pressRippleGeometry(
    width: number,
    height: number,
    clientX: number,
    clientY: number,
    rect: { left: number; top: number },
    scale = 1,
  ) {
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const x = width / 2 + (clientX - rect.left - width / 2) / safeScale;
    const y = height / 2 + (clientY - rect.top - height / 2) / safeScale;
    const diameter = Math.max(
      1,
      2 *
        Math.max(
          Math.hypot(x, y),
          Math.hypot(width - x, y),
          Math.hypot(x, height - y),
          Math.hypot(width - x, height - y),
        ),
    );
    return { x, y, diameter };
  }
  let root = $state<HTMLElement>(),
    surface = $state<HTMLElement>(),
    rippleNode = $state<HTMLElement>();
  let ripple = $state<Ripple | null>(null);
  let pressing = false;
  let scaleAnimation: Animation | null = null,
    rippleAnimation: Animation | null = null;
  let generation = 0;

  function computedScale() {
    if (!surface) return 1;
    const transform = getComputedStyle(surface).transform;
    if (transform === 'none') return 1;
    const matrix = new DOMMatrixReadOnly(transform);
    return Math.hypot(matrix.a, matrix.b) || 1;
  }
  function stopAnimations() {
    scaleAnimation?.cancel();
    scaleAnimation = null;
    rippleAnimation?.cancel();
    rippleAnimation = null;
  }
  function tap() {
    if (!surface || prefersReducedMotion.current) {
      ripple = null;
      return;
    }
    scaleAnimation = surface.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(.97)', offset: 0.3 },
        { transform: 'scale(1)' },
      ],
      { duration: 280, easing: 'ease-out' },
    );
    if (rippleNode) {
      rippleAnimation = rippleNode.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0)', opacity: 0.12 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
        ],
        { duration: 320, easing: 'ease-out', fill: 'forwards' },
      );
      const animation = rippleAnimation,
        key = ripple?.key;
      void animation.finished
        .then(() => {
          if (rippleAnimation !== animation) return;
          ripple = ripple?.key === key ? null : ripple;
          animation.cancel();
          rippleAnimation = null;
        })
        .catch(() => {});
    }
  }
  /** A press started on this tile. */
  export function start(event: PointerEvent) {
    if (disabled || event.button !== 0 || event.isPrimary === false || !root || !surface) {
      return;
    }
    const rect = root.getBoundingClientRect();
    const width = root.clientWidth || rect.width,
      height = root.clientHeight || rect.height;
    const ancestorScale = rect.width / width || 1;
    const scale = computedScale() * ancestorScale;
    const origin = pressRippleGeometry(width, height, event.clientX, event.clientY, rect, scale);
    generation++;
    stopAnimations();
    surface.style.transform = 'none';
    pressing = true;
    ripple = prefersReducedMotion.current ? null : { ...origin, key: generation };
  }
  /** The press ended. Feedback plays only for a tap; a press that moved or was cancelled just drops its ripple. */
  export function end(tapped: boolean) {
    if (!pressing) {
      return;
    }
    pressing = false;
    if (tapped) {
      tap();
      return;
    }
    ripple = null;
    stopAnimations();
    if (surface) {
      surface.style.transform = 'none';
    }
  }
  function abort() {
    generation++;
    stopAnimations();
    pressing = false;
    ripple = null;
    if (surface) surface.style.transform = 'none';
  }

  $effect(() => {
    if (disabled) abort();
  });
  onDestroy(abort);
</script>

<div
  bind:this={root}
  data-dashboard-tile
  style="-webkit-app-region: no-drag"
  class="relative h-full w-full"
>
  <div
    bind:this={surface}
    data-dashboard-tile
    style="-webkit-app-region: no-drag"
    class="relative h-full w-full origin-center {surfaceClass || 'rounded-[inherit]'}"
    class:overflow-hidden={surfaceClass !== 'tile-content'}
  >
    {@render children()}
    {#if ripple}
      <span
        bind:this={rippleNode}
        aria-hidden="true"
        class="pointer-events-none absolute rounded-full bg-white"
        style:left="{ripple.x}px"
        style:top="{ripple.y}px"
        style:width="{ripple.diameter}px"
        style:height="{ripple.diameter}px"
        style:transform="translate(-50%, -50%) scale(0)"
        style:opacity="0"
      ></span>
    {/if}
  </div>
</div>

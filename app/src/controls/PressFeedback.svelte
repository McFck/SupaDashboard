<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import { pressRippleGeometry } from '../core/controls';

  let { disabled = false, class: surfaceClass = '', children }:
    { disabled?: boolean; class?: string; children: Snippet } = $props();
  type Ripple = { x: number; y: number; diameter: number; key: number };
  let root = $state<HTMLElement>(), surface = $state<HTMLElement>(), rippleNode = $state<HTMLElement>();
  let ripple = $state<Ripple | null>(null);
  let pointerId: number | null = null;
  let startX = 0, startY = 0, pressing = false, slopEnded = false;
  let scaleAnimation: Animation | null = null, rippleAnimation: Animation | null = null;
  let generation = 0;

  function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function computedScale() {
    if (!surface) return 1;
    const transform = getComputedStyle(surface).transform;
    if (transform === 'none') return 1;
    const matrix = new DOMMatrixReadOnly(transform);
    return Math.hypot(matrix.a, matrix.b) || 1;
  }
  function stopAnimations() {
    scaleAnimation?.cancel(); scaleAnimation = null;
    rippleAnimation?.cancel(); rippleAnimation = null;
  }
  function removeWindowListeners() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('lostpointercapture', cancel, true);
  }
  function tap() {
    if (!surface || reducedMotion()) { ripple = null; return; }
    scaleAnimation = surface.animate([{ transform: 'scale(1)' }, { transform: 'scale(.97)', offset: .3 }, { transform: 'scale(1)' }],
      { duration: 280, easing: 'ease-out' });
    if (rippleNode) {
      rippleAnimation = rippleNode.animate([{ transform: 'translate(-50%, -50%) scale(0)', opacity: .12 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 }], { duration: 320, easing: 'ease-out', fill: 'forwards' });
      const animation = rippleAnimation, key = ripple?.key;
      void animation.finished.then(() => {
        if (rippleAnimation !== animation) return;
        ripple = ripple?.key === key ? null : ripple;
        animation.cancel();
        rippleAnimation = null;
      }).catch(() => {});
    }
  }
  function down(event: PointerEvent) {
    if (disabled || event.button !== 0 || event.isPrimary === false || pointerId != null || !root || !surface) return;
    const rect = root.getBoundingClientRect();
    const width = root.clientWidth || rect.width, height = root.clientHeight || rect.height;
    const ancestorScale = rect.width / width || 1;
    const scale = computedScale() * ancestorScale;
    const origin = pressRippleGeometry(width, height, event.clientX, event.clientY, rect, scale);
    generation++;
    stopAnimations();
    surface.style.transform = 'none';
    pointerId = event.pointerId;
    startX = event.clientX; startY = event.clientY;
    pressing = true; slopEnded = false;
    ripple = reducedMotion() ? null : { ...origin, key: generation };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('lostpointercapture', cancel, true);
  }
  function move(event: PointerEvent) {
    if (event.pointerId !== pointerId || !pressing || Math.hypot(event.clientX - startX, event.clientY - startY) < 8) return;
    pressing = false; slopEnded = true;
    ripple = null;
    rippleAnimation?.cancel(); rippleAnimation = null;
    scaleAnimation?.cancel(); scaleAnimation = null;
    surface!.style.transform = 'none';
  }
  function finish(event: PointerEvent, cancelled: boolean) {
    if (event.pointerId !== pointerId) return;
    // Feedback plays only for a real tap; a gesture start never shows a press or ripple.
    if (pressing && !cancelled && !slopEnded) tap();
    pressing = false;
    if (cancelled) {
      ripple = null;
      rippleAnimation?.cancel(); rippleAnimation = null;
    }
    pointerId = null;
    removeWindowListeners();
  }
  function up(event: PointerEvent) { finish(event, false); }
  function cancel(event: PointerEvent) { finish(event, true); }
  function abort() {
    generation++;
    removeWindowListeners(); stopAnimations();
    pointerId = null; pressing = false; slopEnded = false; ripple = null;
    if (surface) surface.style.transform = 'none';
  }

  $effect(() => { if (disabled) abort(); });
  onDestroy(abort);
</script>

<div bind:this={root} data-dashboard-tile onpointerdowncapture={down} style="-webkit-app-region: no-drag" class="relative h-full w-full">
  <div bind:this={surface} data-dashboard-tile style="-webkit-app-region: no-drag" class="relative h-full w-full origin-center {surfaceClass || 'rounded-[inherit]'}" class:overflow-hidden={surfaceClass !== 'tile-content'}>
    {@render children()}
    {#if ripple}
      <span bind:this={rippleNode} aria-hidden="true" class="pointer-events-none absolute rounded-full bg-white"
        style:left="{ripple.x}px" style:top="{ripple.y}px" style:width="{ripple.diameter}px" style:height="{ripple.diameter}px"
        style:transform="translate(-50%, -50%) scale(0)" style:opacity="0"></span>
    {/if}
  </div>
</div>

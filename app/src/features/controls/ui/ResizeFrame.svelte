<script lang="ts">
  // One rounded outline of the size the widget will take. A single border keeps the contour continuous.
  import { onDestroy } from 'svelte';
  import { SPRING_SAMPLES } from '$lib/spring';

  let { x = 0, y = 0, width, height, opacity = 1, invalid = false, preferredRadius = 22 }: {
    x?: number; y?: number; width: number; height: number; opacity?: number; invalid?: boolean; preferredRadius?: number;
  } = $props();

  type Box = { x: number; y: number; width: number; height: number };
  let root: HTMLElement | undefined;
  let animation: Animation | undefined;
  let generation = 0;
  const radius = (w: number, h: number) => Math.max(0, Math.min(preferredRadius, w / 2, h / 2));
  const tween = (from: number, to: number, p: number) => from + (to - from) * p;

  export function cancelSettle() {
    generation++;
    animation?.cancel();
  }

  /** Spring the outline onto the snapped box, then fade it out. */
  export function settleTo(target: Box, duration = 360) {
    const run = ++generation;
    animation?.cancel();
    if (!root) return Promise.resolve();
    const from = { x, y, width, height };
    animation = root.animate(SPRING_SAMPLES.map(({ offset, progress: p }) => {
      const w = tween(from.width, target.width, p), h = tween(from.height, target.height, p);
      return { offset, translate: `${tween(from.x, target.x, p)}px ${tween(from.y, target.y, p)}px`,
        width: `${w}px`, height: `${h}px`, borderRadius: `${radius(w, h)}px`, opacity: tween(opacity, 0, p) };
    }), { duration, fill: 'both', easing: 'linear' });
    return animation.finished.catch(() => {}).then(() => { if (run !== generation) return; });
  }

  onDestroy(() => { generation++; animation?.cancel(); });
</script>

<div bind:this={root} aria-hidden="true" class="pointer-events-none absolute left-0 top-0 box-border border"
  style:border-color={invalid ? 'rgb(248 113 113)' : 'rgb(110 231 183)'} style:translate="{x}px {y}px"
  style:width="{width}px" style:height="{height}px" style:border-radius="{radius(width, height)}px" style:opacity></div>

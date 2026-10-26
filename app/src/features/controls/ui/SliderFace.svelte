<script lang="ts">
  import type { ControlFaceProps, SliderFaceState } from '../model';
  import Icon from './Icon.svelte';

  let { appearance, slider }: ControlFaceProps = $props();
  const sliderState = $derived(slider ?? { level: null, muted: false, orientation: 'vertical', active: false, fillReady: false,
    animateFill: false, sourceKey: '', accent: '#8ea8f0' } satisfies SliderFaceState);
  const vertical = $derived(sliderState.orientation === 'vertical');
  const pct = $derived(sliderState.level == null ? null : Math.round(sliderState.level * 100));
  let width = $state(0), height = $state(0);
  const faceScale = $derived.by(() => {
    const thick = vertical ? width : height, long = vertical ? height : width;
    if (!thick || !long) return 1;
    return Math.max(.7, Math.min(2.4, thick / 64, (long - 40) / (vertical ? 70 : 140)));
  });
  function viewBackground() {
    return appearance.background === undefined
      ? `color-mix(in oklab, ${appearance.color ?? sliderState.accent} 10%, rgb(0 0 0 / .35))`
      : appearance.background ?? 'transparent';
  }
</script>

<div bind:clientWidth={width} bind:clientHeight={height} aria-hidden="true"
  class="pointer-events-none absolute inset-0 overflow-hidden rounded-[18px]"
  style:background="color-mix(in oklab, {sliderState.accent} 12%, #171b22)">
  <div aria-hidden="true" data-slider-fill={sliderState.sourceKey} class="pointer-events-none absolute inset-0"
    style:transform-origin={vertical ? 'bottom' : 'left'}
    style:transform={vertical ? `scaleY(${sliderState.level ?? 0})` : `scaleX(${sliderState.level ?? 0})`}
    style:transition={sliderState.animateFill ? 'transform 190ms ease-out' : 'none'}
    style:background={sliderState.muted ? '#a1a1aa' : sliderState.accent}></div>
  <div class="pointer-events-none absolute inset-0">
    <div class="flex h-full w-full min-w-0 items-center justify-between gap-2 text-white {vertical ? 'flex-col px-2 py-3' : 'px-3 py-1.5'}"
      style:background={viewBackground()}>
      {#if vertical}
        <span class="font-semibold tabular-nums" style:font-size="{14 * faceScale}px">{pct == null ? '—' : `${pct}%`}</span>
        {#if appearance.label}<span class="w-full min-w-0 truncate text-center font-semibold" style:font-size="{11 * faceScale}px" style:color={appearance.color ?? undefined}>{appearance.label}</span>{/if}
        <span class="shrink-0" class:opacity-60={sliderState.muted} style:color={appearance.color ?? undefined}>
          <Icon name={appearance.icon ?? undefined} size={20 * faceScale} fallback={appearance.label?.[0]?.toUpperCase() ?? ''} />
        </span>
      {:else}
        <span class="shrink-0" class:opacity-60={sliderState.muted} style:color={appearance.color ?? undefined}>
          <Icon name={appearance.icon ?? undefined} size={18 * faceScale} fallback={appearance.label?.[0]?.toUpperCase() ?? ''} />
        </span>
        {#if appearance.label}<span class="min-w-0 flex-1 truncate font-semibold" style:font-size="{12 * faceScale}px" style:color={appearance.color ?? undefined}>{appearance.label}</span>{/if}
        <span class="shrink-0 font-semibold tabular-nums" style:font-size="{14 * faceScale}px">{pct == null ? '—' : `${pct}%`}</span>
      {/if}
    </div>
  </div>
</div>

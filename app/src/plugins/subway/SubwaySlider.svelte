<script lang="ts">
  import type { ControlFaceProps } from '../../features/controls/model';
  import { getSkinHostContext } from '../../features/skins/context';
  import Icon from '../../features/controls/ui/Icon.svelte';
  import { subwaySliderFaceModel } from './faces';

  let { appearance, compact, busy, pull, slider, pixelWidth, pixelHeight }: ControlFaceProps = $props();
  const host = getSkinHostContext();
  const lineId = $derived(host?.state.line);
  const model = $derived(subwaySliderFaceModel({ appearance, compact, busy, pull, slider, pixelWidth, pixelHeight } as ControlFaceProps, lineId));
  const vertical = $derived(model.orientation === 'vertical');
  const pct = $derived(model.fillReady && model.active ? `${Math.round(model.level * 100)}%` : '—');
  function trackBackground() {
    return model.background === undefined ? `color-mix(in oklab, ${model.color} 13%, #171b22)` : model.background ?? 'transparent';
  }
</script>

<span class="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] border border-white/10"
  style:background={trackBackground()} style:border-left-color={model.color} style:border-left-width="3px"
  style:transform={model.transform ?? 'none'} style:opacity={model.disabledVisual ? 0.62 : 1}>
  <span aria-hidden="true" class="absolute inset-0"
    style:transform-origin={vertical ? 'bottom' : 'left'}
    style:transform={vertical ? `scaleY(${model.fillReady ? model.level : 0})` : `scaleX(${model.fillReady ? model.level : 0})`}
    style:transition={model.transition} style:background={model.muted ? '#9ca3af' : model.color}></span>
  <span class="absolute inset-0 flex items-center justify-between gap-2 px-2.5 py-2 text-white" class:flex-col={vertical}
    style:background={model.background === undefined ? `color-mix(in oklab, ${model.color} 8%, transparent)` : model.background ?? 'transparent'}>
    {#if vertical}
      <span class="font-semibold tabular-nums">{pct}</span>
      {#if !model.compact && model.label}<span class="w-full truncate text-center text-xs font-semibold">{model.label}</span>{/if}
      <Icon name={model.icon ?? undefined} size={20} fallback={model.label?.[0]?.toUpperCase() ?? ''} />
    {:else}
      <Icon name={model.icon ?? undefined} size={18} fallback={model.label?.[0]?.toUpperCase() ?? ''} />
      {#if !model.compact && model.label}<span class="min-w-0 flex-1 truncate text-xs font-semibold">{model.label}</span>{/if}
      <span class="font-semibold tabular-nums">{pct}</span>
    {/if}
  </span>
</span>

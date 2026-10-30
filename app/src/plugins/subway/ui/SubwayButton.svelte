<script lang="ts">
  import type { ControlFaceProps } from '../../../features/controls/model';
  import { getAppletHostContext } from '../../../features/applets/context';
  import Icon from '../../../features/controls/ui/Icon.svelte';
  import { lineIdentity, subwayButtonFaceModel } from './faces';

  let { appearance, compact, busy, pull, pixelWidth, pixelHeight }: ControlFaceProps = $props();
  const host = getAppletHostContext();
  const lineId = $derived(host?.state.line);
  const audioReady = $derived(host?.state.audioReady);
  const model = $derived(
    subwayButtonFaceModel(
      { appearance, compact, busy, pull, pixelWidth, pixelHeight } as ControlFaceProps,
      lineId,
    ),
  );
  const icon = $derived(
    model.label?.toLowerCase().includes('immersion') && audioReady !== true
      ? 'VolumeX'
      : model.icon,
  );
  const lineCode = $derived(lineIdentity(lineId)?.letter ?? 'JY');
  const iconSize = $derived(Math.max(28, Math.min(pixelWidth, pixelHeight) * 0.44));
</script>

<span
  class="relative flex h-full w-full items-center justify-center gap-2 overflow-hidden rounded-[inherit] border border-white/10 px-2 text-white transition-[opacity,transform] duration-150"
  style:color={model.color}
  style:background={model.background === undefined
    ? `color-mix(in oklab, ${model.color} 11%, #171b22)`
    : (model.background ?? 'transparent')}
  style:border-left-color={model.color}
  style:border-left-width="3px"
  style:transform={model.transform ?? 'none'}
  style:opacity={model.disabledVisual ? 0.58 : 1}
>
  <span
    class="grid shrink-0 place-items-center"
    style={`width:${iconSize}px;height:${iconSize}px`}
    aria-hidden="true"
  >
    <Icon
      name={icon ?? undefined}
      size={iconSize}
      fallback={lineCode}
    />
  </span>
  {#if !model.compact && model.label}
    <span class="min-w-0 flex-1 truncate text-left text-sm font-semibold tracking-wide"
      >{model.label}</span
    >
  {/if}
  {#if model.busy}<span
      class="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-current"
      aria-hidden="true"
    ></span>{/if}
</span>

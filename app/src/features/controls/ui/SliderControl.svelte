<script lang="ts">
  import type { Component } from 'svelte';
  // One level slider widget. Its long side is the value axis; swipes across it use the gesture map.
  import { toast } from 'svelte-sonner';
  import { pullBindingsFor, type PullSnapshot } from '../input/pull';
  import { sliderOrientation } from '../geometry';
  import type {
    ControlConfig,
    ControlFaceProps,
    TilePresentation,
    Variant,
  } from '../model';
  import { stateIdAt } from '../variants';
  import type { Trigger } from '../../automation/scenario';
  import { onDestroy } from 'svelte';
  import { value as valueOf } from '../../plugins/registry';
  import { findVolumeChannel, setVolume, volumeChannels } from '../../media/volume';
  import PullContent from './PullContent.svelte';
  import PressFeedback from './PressFeedback.svelte';
  import SliderTrack from './SliderTrack.svelte';
  import { ControlTile } from './control-tile.svelte';

  let {
    control,
    compact = false,
    pixelWidth,
    pixelHeight,
    presentation,
    face,
    pressFeedbackDisabled = false,
    itemId,
  }: {
    control: ControlConfig;
    compact?: boolean;
    pixelWidth: number;
    pixelHeight: number;
    presentation?: TilePresentation;
    face?: Component<ControlFaceProps>;
    pressFeedbackDisabled?: boolean;
    itemId?: string;
  } = $props();
  const tile = new ControlTile({ control: () => control, itemId: () => itemId });
  const current = $derived(tile.current);
  const variant = $derived(tile.variant);
  const volumeTarget = $derived(
    variant.value?.id === 'volume' ? String(variant.value.args?.target ?? 'system') : null,
  );
  const volumeChannel = $derived(
    volumeTarget ? findVolumeChannel($volumeChannels, volumeTarget) : null,
  );
  const source = $derived(
    variant.value && variant.value.id !== 'volume' ? valueOf(variant.value) : null,
  );
  const sourceKey = $derived(
    variant.value
      ? `${variant.value.id}:${JSON.stringify(variant.value.args ?? {})}`
      : `${control.id}:unavailable`,
  );
  const vertical = $derived(
    !compact &&
      sliderOrientation(
pixelWidth, pixelHeight
      ) === 'vertical',
  );
  let content = $state<PullContent>();
  let feedback = $state<PressFeedback>();
  /** Level a not-yet-active variant would show; only volume sources can be read without subscribing. */
  function previewLevel(v: Variant) {
    if (v.value?.id !== 'volume') return null;
    return (
      findVolumeChannel($volumeChannels, String(v.value.args?.target ?? 'system'))?.volume ?? null
    );
  }
  let genericLevel = $state<number | null>(null);
  const level = $derived(volumeTarget != null ? (volumeChannel?.volume ?? null) : genericLevel);
  const muted = $derived(volumeTarget != null ? (volumeChannel?.muted ?? false) : false);
  let pull = $state<PullSnapshot | null>(null);
  let dragging = false;
  let sourceGeneration = 0;
  let alive = true;
  const pullBindings = $derived(
    pullBindingsFor(
      control,
      current,
      vertical ? ['swipeLeft', 'swipeRight'] : ['swipeUp', 'swipeDown'],
    ),
  );
  function presentationFor(view: Variant): TilePresentation {
    const index = control.variants.indexOf(view);
    return presentation && index === current ? presentation : { key: `variant:${index}`, view };
  }

  // Follow outside changes (keyboard volume keys, the app's own slider) while idle.
  $effect(() => {
    if (volumeTarget != null) {
      genericLevel = null;
      return;
    }
    const s = source;
    if (!s) {
      genericLevel = null;
      return;
    }
    const generation = ++sourceGeneration;
    const read = () => {
      if (dragging) return;
      s.get()
        .then((v) => {
          if (alive && generation === sourceGeneration && !dragging) genericLevel = v;
        })
        .catch(() => {
          if (alive && generation === sourceGeneration && !dragging) genericLevel = null;
        });
    };
    read();
    const timer = setInterval(read, 1200);
    return () => {
      clearInterval(timer);
      if (generation === sourceGeneration) sourceGeneration++;
    };
  });
  onDestroy(() => {
    alive = false;
    sourceGeneration++;
  });

  let pending: number | null = null,
    writing = false;
  function write(v: number) {
    if (volumeTarget != null) {
      void setVolume(volumeTarget, v).catch((error) =>
        toast.error(`${control.name}: ${error?.message ?? error}`),
      );
      return;
    }
    genericLevel = v;
    pending = v;
    dragging = true;
    if (writing) return;
    void (async () => {
      writing = true;
      while (pending != null) {
        const next = pending;
        pending = null;
        await source?.set(next).catch(() => {});
      }
      writing = false;
      dragging = false;
    })();
  }
  function onTrigger(_trigger: Trigger, captured?: unknown, snapshot?: PullSnapshot) {
    tile.run(captured, snapshot, content);
  }
</script>

<div
  data-dashboard-tile
  style:--accent={variant.color ?? '#8ea8f0'}
  class="relative h-full w-full"
>
  <PressFeedback
    bind:this={feedback}
    disabled={pressFeedbackDisabled}
    class={compact ? 'min-w-48 rounded-lg' : 'tile'}
  >
    {#snippet children()}
      <PullContent
        bind:this={content}
        {control}
        {current}
        {pull}
      >
        {#snippet children(v, outgoing, immediate)}
          {@const shown = outgoing ? variant : v}
          {@const resolved = presentationFor(shown)}
          {@const stateIndex = Math.max(0, control.variants.indexOf(shown))}
          <div
            data-dashboard-tile
            class="h-full w-full {compact ? 'px-2 py-2' : 'p-2.5'}"
          >
            {#if outgoing}
              <SliderTrack
                {level}
                {muted}
                {vertical}
                {pullBindings}
                {sourceKey}
                accent={variant.color ?? '#8ea8f0'}
                icon={variant.icon ?? undefined}
                label={variant.label}
                {face}
                {compact}
                stateId={stateIdAt(control, stateIndex)}
                {stateIndex}
                busy={tile.busy}
                {pull}
                {pixelWidth}
                {pixelHeight}
                presentation={resolved}
                presentationImmediate={immediate}
                onchange={write}
                onpullstart={() => content?.beginPull()}
                onpull={(p) => {
                  pull = p;
                }}
                onpullend={(p, armed) => {
                  if (p && !armed) void content?.release(p);
                }}
                oncancel={(p) => content?.cancelPull(p)}
                capturetrigger={tile.capture}
                ontrigger={onTrigger}
                {feedback}
              />
            {:else}
              <SliderTrack
                level={previewLevel(v)}
                muted={false}
                {vertical}
                sourceKey={`preview:${v.id ?? ''}`}
                accent={v.color ?? '#8ea8f0'}
                icon={v.icon ?? undefined}
                label={v.label}
                {face}
                {compact}
                stateId={stateIdAt(control, stateIndex)}
                {stateIndex}
                busy={false}
                pull={null}
                {pixelWidth}
                {pixelHeight}
                presentation={resolved}
                presentationImmediate
                onchange={() => {}}
              />
            {/if}
          </div>
        {/snippet}
      </PullContent>
    {/snippet}
  </PressFeedback>
</div>

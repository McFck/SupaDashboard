<script lang="ts">
  // One level slider widget. Its long side is the value axis; swipes across it use the gesture map.
  import { toast } from 'svelte-sonner';
  import { pullBindingsFor, sliderOrientation, type ControlConfig, type Gesture, type PullSnapshot,
    type TilePresentation, type Variant } from '../core/controls';
  import { effectiveVariant } from '../core/button-state';
  import { captureRuntimeTrigger, dispatchRuntimePacket, runtimeView } from '../core/runtime.svelte';
  import type { Trigger } from '../core/scenario';
  import type { TriggerPacket } from '../core/scenario-runner';
  import { onDestroy } from 'svelte';
  import { value as valueOf } from '../core/registry';
  import { settings } from '../core/settings.svelte';
  import { findVolumeChannel, setVolume, volumeChannels } from '../core/volume';
  import PullContent from './PullContent.svelte';
  import PressFeedback from './PressFeedback.svelte';
  import SliderTrack from './SliderTrack.svelte';

  let { control, compact = false, w = 1, h = 3, pixelWidth, pixelHeight, presentation,
    pressFeedbackDisabled = false, itemId }: {
    control: ControlConfig; compact?: boolean; w?: number; h?: number; pixelWidth?: number; pixelHeight?: number;
    presentation?: TilePresentation; pressFeedbackDisabled?: boolean; itemId?: string;
  } = $props();
  const manualIndex = $derived(settings.variants[control.id] ?? 0);
  const current = $derived(effectiveVariant(control, $runtimeView.variables, manualIndex).index);
  const variant = $derived(control.variants[current] ?? control.variants[0]);
  const volumeTarget = $derived(variant.value?.id === 'volume' ? String(variant.value.args?.target ?? 'system') : null);
  const volumeChannel = $derived(volumeTarget ? findVolumeChannel($volumeChannels, volumeTarget) : null);
  const source = $derived(variant.value && variant.value.id !== 'volume' ? valueOf(variant.value) : null);
  const sourceKey = $derived(variant.value ? `${variant.value.id}:${JSON.stringify(variant.value.args ?? {})}` : `${control.id}:unavailable`);
  let width = $state(0), height = $state(0);
  const vertical = $derived(!compact && sliderOrientation(pixelWidth ?? (width || w * settings.deck.size + (w - 1) * settings.deck.gap),
    pixelHeight ?? (height || h * settings.deck.size + (h - 1) * settings.deck.gap)) === 'vertical');
  let content = $state<PullContent>();
  /** Level a not-yet-active variant would show; only volume sources can be read without subscribing. */
  function previewLevel(v: Variant) {
    if (v.value?.id !== 'volume') return null;
    return findVolumeChannel($volumeChannels, String(v.value.args?.target ?? 'system'))?.volume ?? null;
  }
  let genericLevel = $state<number | null>(null);
  const level = $derived(volumeTarget != null ? volumeChannel?.volume ?? null : genericLevel);
  const muted = $derived(volumeTarget != null ? volumeChannel?.muted ?? false : false);
  let pull = $state<PullSnapshot | null>(null);
  let dragging = false;
  let sourceGeneration = 0;
  let alive = true;
  const pullBindings = $derived(pullBindingsFor(control, current,
    vertical ? ['swipeLeft', 'swipeRight'] : ['swipeUp', 'swipeDown']));
  function presentationFor(view: Variant): TilePresentation {
    const index = control.variants.indexOf(view);
    return presentation && index === current ? presentation : { key: `variant:${index}`, view };
  }

  // Follow outside changes (keyboard volume keys, the app's own slider) while idle.
  $effect(() => {
    if (volumeTarget != null) { genericLevel = null; return; }
    const s = source;
    if (!s) { genericLevel = null; return; }
    const generation = ++sourceGeneration;
    const read = () => {
      if (dragging) return;
      s.get().then(v => {
        if (alive && generation === sourceGeneration && !dragging) genericLevel = v;
      }).catch(() => {
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
  onDestroy(() => { alive = false; sourceGeneration++; });

  let pending: number | null = null, writing = false;
  function write(v: number) {
    if (volumeTarget != null) {
      void setVolume(volumeTarget, v).catch(error => toast.error(`${control.name}: ${error?.message ?? error}`));
      return;
    }
    genericLevel = v;
    pending = v;
    dragging = true;
    if (writing) return;
    void (async () => {
      writing = true;
      while (pending != null) { const next = pending; pending = null; await source?.set(next).catch(() => {}); }
      writing = false;
      dragging = false;
    })();
  }
  function onTrigger(trigger: Trigger, captured?: unknown, snapshot?: PullSnapshot) {
    const packet = captured as TriggerPacket | undefined;
    if (snapshot) {
      void content?.release(trigger as Gesture, snapshot, () => { void dispatchRuntimePacket(packet); });
      return;
    }
    void dispatchRuntimePacket(packet);
  }
</script>

<div data-dashboard-tile bind:clientWidth={width} bind:clientHeight={height} style:--accent={variant.color ?? '#8ea8f0'} class="relative h-full w-full">
  <PressFeedback disabled={pressFeedbackDisabled} class={compact ? 'min-w-48 rounded-lg' : 'tile'}>
    {#snippet children()}
      <PullContent bind:this={content} {control} {current} {pull}>
        {#snippet children(v, outgoing, immediate)}
          {@const shown = outgoing ? variant : v}
          {@const resolved = presentationFor(shown)}
          <div data-dashboard-tile class="h-full w-full {compact ? 'px-2 py-2' : 'p-2.5'}">
            {#if outgoing}
              <SliderTrack level={level} {muted} {vertical} {pullBindings} sourceKey={sourceKey}
                accent={variant.color ?? '#8ea8f0'} icon={variant.icon ?? undefined} label={variant.label}
                presentation={resolved} presentationImmediate={immediate}
                doubleTap={!!control.scenario?.triggers.doubleTap} onchange={write}
                onpullstart={() => content?.beginPull()} onpull={p => { pull = p; }}
                onpullend={(p, armed) => { if (p && !armed) void content?.release(undefined, p); }}
                oncancel={p => content?.cancelPull(p)}
                capturetrigger={(trigger, interactionId) => captureRuntimeTrigger(control.id, itemId ?? '', trigger, interactionId)}
                ontrigger={onTrigger} />
            {:else}
              <SliderTrack level={previewLevel(v)} muted={false} {vertical} sourceKey={`preview:${v.id ?? ''}`}
                accent={v.color ?? '#8ea8f0'} icon={v.icon ?? undefined} label={v.label}
                presentation={resolved} presentationImmediate onchange={() => {}} />
            {/if}
          </div>
        {/snippet}
      </PullContent>
    {/snippet}
  </PressFeedback>
</div>

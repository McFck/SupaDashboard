<script lang="ts">
  import { buttonIconSize, pullBindingsFor, type ControlConfig, type Gesture, type PullSnapshot,
    type TilePresentation, type Variant } from '../core/controls';
  import { gestures } from '../core/gestures';
  import { effectiveVariant, stateIdAt } from '../core/button-state';
  import { captureRuntimeTrigger, dispatchRuntimePacket, runtimeView } from '../core/runtime.svelte';
  import type { TriggerPacket } from '../core/scenario-runner';
  import { settings, type Page } from '../core/settings.svelte';
  import ButtonFace from './ButtonFace.svelte';
  import PullContent from './PullContent.svelte';
  import PressFeedback from './PressFeedback.svelte';
  import StateView from './StateView.svelte';

  let { control, page, compact = false, w = 1, h = 1, pixelWidth, pixelHeight, presentation,
    pressFeedbackDisabled = false, itemId }: {
    control: ControlConfig; page?: Page; compact?: boolean; w?: number; h?: number; pixelWidth?: number; pixelHeight?: number;
    presentation?: TilePresentation; pressFeedbackDisabled?: boolean; itemId?: string;
  } = $props();
  let pull = $state<PullSnapshot | null>(null);
  let width = $state(0), height = $state(0);
  let content = $state<PullContent>();
  const manualIndex = $derived(settings.variants[control.id] ?? 0);
  const effective = $derived(effectiveVariant(control, $runtimeView.variables, manualIndex));
  const current = $derived(effective.index);
  const variant = $derived(control.variants[current] ?? control.variants[0]);
  const resolvedPresentation = $derived(presentation ?? { key: `state:${effective.stateId}`, view: effective.view });
  const accent = $derived(resolvedPresentation.view.color ?? variant.color ?? '#67c9eb');
  const busy = $derived(($runtimeView.busy[control.id] ?? 0) > 0);
  const fallbackWidth = $derived(w * (page?.size ?? 112) + (w - 1) * (page?.gap ?? 14));
  const fallbackHeight = $derived(h * (page?.size ?? 112) + (h - 1) * (page?.gap ?? 14));
  const iconSize = $derived(buttonIconSize(pixelWidth ?? (width || fallbackWidth), pixelHeight ?? (height || fallbackHeight), compact));
  function presentationFor(view: Variant): TilePresentation {
    const index = control.variants.indexOf(view);
    // Same key for the same state wherever it renders, so a committed pull never crossfades a face into itself.
    return index === current ? resolvedPresentation : { key: `state:${stateIdAt(control, index)}`, view };
  }
  function onTrigger(trigger: import('../core/scenario').Trigger, captured?: unknown, snapshot?: PullSnapshot) {
    const packet = captured as TriggerPacket | undefined;
    if (snapshot) {
      void content?.release(trigger as Gesture, snapshot, () => { void dispatchRuntimePacket(packet); });
      return;
    }
    void dispatchRuntimePacket(packet);
  }
</script>

<button data-dashboard-tile bind:clientWidth={width} bind:clientHeight={height} use:gestures={{
    onGesture: () => {}, onTrigger, captureTrigger: (trigger, interactionId) =>
      captureRuntimeTrigger(control.id, itemId ?? '', trigger, interactionId),
    enabled: !pressFeedbackDisabled, pullBindings: () => pullBindingsFor(control, current),
    onStart: () => content?.beginPull(), onPull: p => { pull = p; },
    onPullEnd: (p, armed) => { if (p && !armed) void content?.release(undefined, p); },
    onCancel: p => content?.cancelPull(p) }}
  aria-label={(resolvedPresentation.view.label ?? variant.label) || undefined} style:--accent={accent}
  class="relative h-full w-full min-h-0 min-w-0 select-none touch-none overflow-hidden outline-none">
  <PressFeedback disabled={pressFeedbackDisabled} class={compact ? 'min-w-12 rounded-lg text-zinc-100 hover:bg-white/5' : 'tile'}>
    {#snippet children()}
      <PullContent bind:this={content} {control} {current} {pull}>
        {#snippet children(v, _outgoing, immediate)}
          <StateView presentation={presentationFor(v)} {immediate} class="h-full w-full">
            {#snippet children(view)}
              <ButtonFace {view} {iconSize} {compact} {busy} />
            {/snippet}
          </StateView>
        {/snippet}
      </PullContent>
    {/snippet}
  </PressFeedback>
</button>

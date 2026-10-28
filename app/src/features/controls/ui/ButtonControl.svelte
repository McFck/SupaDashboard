<script lang="ts">
  import type { Component } from 'svelte';
  import { pullBindingsFor, type PullSnapshot } from '../input/pull';
  import type {
    ControlConfig,
    ControlFaceProps,
    TilePresentation,
    Variant,
  } from '../model';
  import { gestures } from '../input/gestures';
  import { effectiveVariant, stateIdAt } from '../button-state';
  import { runtimeView } from '../../../app/runtime/state';
  import { runtimeVariables } from '../../automation/runtime-variables.svelte';
  import type { TriggerPacket } from '../../automation/scenario-runner';
  import { settings } from '../../settings/state.svelte';
  import ButtonFace from './ButtonFace.svelte';
  import PullContent from './PullContent.svelte';
  import PressFeedback from './PressFeedback.svelte';
  import StateView from './StateView.svelte';
  import { buttonLabelVisible } from '../face-layout';
  import { getRuntimeCommands } from '../../../app/runtime/context';

  const { captureRuntimeTrigger, dispatchRuntimePacket } = getRuntimeCommands();

  let {
    control,
    compact = false,
    pixelWidth,
    pixelHeight,
    presentation,
    face = ButtonFace,
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
  let pull = $state<PullSnapshot | null>(null);
  let width = $state(0),
    height = $state(0);
  let content = $state<PullContent>();
  let feedback = $state<PressFeedback>();
  const manualIndex = $derived(settings.variants[control.id] ?? 0);
  const effective = $derived(effectiveVariant(control, runtimeVariables, manualIndex));
  const current = $derived(effective.index);
  const variant = $derived(control.variants[current] ?? control.variants[0]);
  const resolvedPresentation = $derived(
    presentation ?? { key: `state:${effective.stateId}`, view: effective.view },
  );
  const accent = $derived(resolvedPresentation.view.color ?? variant.color ?? '#67c9eb');
  const busy = $derived(($runtimeView.busy[control.id] ?? 0) > 0);
  const faceLabelHidden = $derived(
    !buttonLabelVisible(
width || pixelWidth, height || pixelHeight
    ),
  );
  const Face = $derived(face ?? ButtonFace);
  function presentationFor(view: Variant): TilePresentation {
    const index = control.variants.indexOf(view);
    // Same key for the same state wherever it renders, so a committed pull never crossfades a face into itself.
    return index === current
      ? resolvedPresentation
      : { key: `state:${stateIdAt(control, index)}`, view };
  }
  function onTrigger(
    trigger: import('../../automation/scenario').Trigger,
    captured?: unknown,
    snapshot?: PullSnapshot,
  ) {
    const packet = captured as TriggerPacket | undefined;
    if (snapshot) {
      void content?.release(snapshot, () => {
        void dispatchRuntimePacket(packet);
      });
      return;
    }
    void dispatchRuntimePacket(packet);
  }
</script>

<button
  data-dashboard-tile
  data-face-label-hidden={faceLabelHidden}
  bind:clientWidth={width}
  bind:clientHeight={height}
  use:gestures={{
    onTrigger,
    captureTrigger: (trigger, interactionId) =>
      captureRuntimeTrigger(control.id, itemId ?? '', trigger, interactionId),
    enabled: !pressFeedbackDisabled,
    pullBindings: () => pullBindingsFor(control, current),
    onStart: () => content?.beginPull(),
    onPull: (p) => {
      pull = p;
    },
    onPullEnd: (p, armed) => {
      if (p && !armed) void content?.release(p);
    },
    onCancel: (p) => content?.cancelPull(p),
    feedback,
  }}
  aria-label={(resolvedPresentation.view.label ?? variant.label) || undefined}
  style:--accent={accent}
  class="relative h-full w-full min-h-0 min-w-0 select-none touch-none overflow-hidden outline-none"
>
  <PressFeedback
    bind:this={feedback}
    disabled={pressFeedbackDisabled}
    class={compact ? 'min-w-12 rounded-lg text-zinc-100 hover:bg-white/5' : 'tile'}
  >
    {#snippet children()}
      <PullContent
        bind:this={content}
        {control}
        {current}
        {pull}
      >
        {#snippet children(v, _outgoing, immediate)}
          <StateView
            presentation={presentationFor(v)}
            {immediate}
            class="h-full w-full"
          >
            {#snippet children(view)}
              {@const index = Math.max(0, control.variants.indexOf(v))}
              <div class="pointer-events-none h-full w-full">
                <Face
                  appearance={view}
                  presentation={presentationFor(v)}
                  stateId={stateIdAt(control, index)}
                  stateIndex={index}
                  {busy}
                  {pull}
                  {compact}
                  {pixelWidth}
                  {pixelHeight}
                />
              </div>
            {/snippet}
          </StateView>
        {/snippet}
      </PullContent>
    {/snippet}
  </PressFeedback>
</button>

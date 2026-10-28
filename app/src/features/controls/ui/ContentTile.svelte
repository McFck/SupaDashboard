<script lang="ts">
  import { onDestroy } from 'svelte';
  import { effectiveVariant } from '../button-state';
  import { pullBindingsFor, type PullSnapshot } from '../interaction';
  import { SPRING_SAMPLES, springDuration } from '$lib/spring';
  import type { ControlConfig } from '../model';
  import { gestures } from '../gestures';
  import { runtimeVariables } from '../../automation/runtime-variables.svelte';
  import type { TriggerPacket } from '../../automation/scenario-runner';
  import type { Trigger } from '../../automation/scenario';
  import { settings } from '../../settings/state.svelte';
  import PressFeedback from './PressFeedback.svelte';
  import { getRuntimeCommands } from '../../../app/runtime/context';

  const { captureRuntimeTrigger, dispatchRuntimePacket } = getRuntimeCommands();

  let {
    control,
    pageId,
    pageVisible = true,
    itemId,
    pressFeedbackDisabled = false,
    passThrough = false,
    onCommitted,
    children: content,
  }: {
    control: ControlConfig;
    pageId?: string;
    pageVisible?: boolean;
    itemId?: string;
    pressFeedbackDisabled?: boolean;
    passThrough?: boolean;
    onCommitted?: (trigger: Trigger) => void;
    children: import('svelte').Snippet;
  } = $props();
  let pull = $state<PullSnapshot | null>(null);
  let settling = $state(false);
  let face = $state<HTMLElement>();
  let animation: Animation | undefined;
  const current = $derived(
    effectiveVariant(control, runtimeVariables, settings.variants[control.id] ?? 0).index,
  );
  const translate = $derived(
    pull && !settling
      ? `translate3d(${pull.axis === 'x' ? pull.offset : 0}px, ${pull.axis === 'y' ? pull.offset : 0}px, 0)`
      : 'none',
  );

  function settle(snapshot: PullSnapshot | null) {
    if (animation) {
      animation.cancel();
      animation = undefined;
    }
    const active = snapshot ?? pull;
    if (!active || !face) {
      pull = null;
      settling = false;
      return;
    }
    pull = active;
    settling = true;
    const x = active.axis === 'x' ? active.offset : 0;
    const y = active.axis === 'y' ? active.offset : 0;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : springDuration(Math.hypot(x, y));
    const currentAnimation = face.animate(
      SPRING_SAMPLES.map(({ progress }) => ({
        transform: `translate3d(${x * (1 - progress)}px, ${y * (1 - progress)}px, 0)`,
      })),
      { duration, easing: 'linear', fill: 'forwards' },
    );
    animation = currentAnimation;
    void currentAnimation.finished
      .then(() => {
        if (animation !== currentAnimation) return;
        animation = undefined;
        pull = null;
        settling = false;
      })
      .catch(() => {});
  }
  function trigger(_trigger: Trigger, captured?: unknown) {
    onCommitted?.(_trigger);
    void dispatchRuntimePacket(captured as TriggerPacket | undefined);
  }
  onDestroy(() => {
    animation?.cancel();
    animation = undefined;
  });
</script>

<div
  data-content-tile
  data-page-id={pageId}
  data-page-visible={pageVisible}
  class="relative h-full w-full min-h-0 min-w-0"
>
  <PressFeedback
    disabled={pressFeedbackDisabled || passThrough}
    class="tile-content"
  >
    {#snippet children()}
      <div
        bind:this={face}
        class="absolute inset-0"
        style:transform={translate}
      >
        {@render content()}
      </div>
      {#if !passThrough}
        <button
          type="button"
          aria-label={control.name || 'Content'}
          tabindex="-1"
          disabled={pressFeedbackDisabled}
          use:gestures={{
            onTrigger: trigger,
            captureTrigger: (event, interactionId) =>
              captureRuntimeTrigger(control.id, itemId ?? '', event, interactionId),
            enabled: !pressFeedbackDisabled,
            pullBindings: () => pullBindingsFor(control, current),
            onPull: (value) => {
              if (!settling) pull = value;
            },
            onPullEnd: (value) => settle(value),
            onCancel: settle,
          }}
          class="content-tile-input"
        ></button>
      {/if}
    {/snippet}
  </PressFeedback>
</div>

<style>
  .content-tile-input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    opacity: 0;
    touch-action: none;
    -webkit-app-region: no-drag;
  }
</style>

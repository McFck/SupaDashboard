<script lang="ts">
  import { onDestroy } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { pullBindingsFor, type PullSnapshot } from '../input/pull';
  import { springTranslate, springDuration } from '$lib/spring';
  import type { ControlConfig } from '../model';
  import { gestures } from '../input/gestures';
  import type { Trigger } from '../../automation/scenario';
  import PressFeedback from './PressFeedback.svelte';
  import { ControlTile } from './control-tile.svelte';

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
  let feedback = $state<PressFeedback>();
  let animation: Animation | undefined;
  // Pose a settling pull was interrupted at; a new pull continues from there instead of jumping.
  let base = $state({ x: 0, y: 0 });
  const tile = new ControlTile({ control: () => control, itemId: () => itemId });

  const translate = $derived(
    pull && !settling
      ? `translate3d(${base.x + (pull.axis === 'x' ? pull.offset : 0)}px, ${base.y + (pull.axis === 'y' ? pull.offset : 0)}px, 0)`
      : 'none',
  );

  function stop() {
    animation?.cancel();
    animation = undefined;
  }
  /** A new pointer sequence interrupts a settling pull at its rendered pose. */
  function beginPull() {
    if (!settling || !face) return;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(face).transform);
    stop();
    base = { x: matrix.m41, y: matrix.m42 };
    pull = null;
    settling = false;
  }

  function settle(snapshot: PullSnapshot | null) {
    stop();
    const active = snapshot ?? pull;
    if (!active || !face) {
      pull = null;
      settling = false;
      return;
    }
    pull = active;
    settling = true;
    const x = base.x + (active.axis === 'x' ? active.offset : 0);
    const y = base.y + (active.axis === 'y' ? active.offset : 0);
    const duration = prefersReducedMotion.current ? 0 : springDuration(Math.hypot(x, y));
    const currentAnimation = springTranslate(
      face,
      { x, y },
      { x: 0, y: 0 },
      { duration, easing: 'linear', fill: 'forwards' },
    );
    animation = currentAnimation;
    void currentAnimation.finished
      .then(() => {
        if (animation !== currentAnimation) return;
        // fill: forwards would otherwise keep overriding the transform of every later pull.
        stop();
        base = { x: 0, y: 0 };
        pull = null;
        settling = false;
      })
      .catch(() => {});
  }
  function trigger(committed: Trigger, captured?: unknown) {
    onCommitted?.(committed);
    tile.run(captured);
  }
  onDestroy(stop);
</script>

<div
  data-content-tile
  data-page-id={pageId}
  data-page-visible={pageVisible}
  class="relative h-full w-full min-h-0 min-w-0"
>
  <PressFeedback
    bind:this={feedback}
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
            captureTrigger: tile.capture,
            enabled: !pressFeedbackDisabled,
            pullBindings: () => pullBindingsFor(control, tile.current),
            onStart: beginPull,
            onPull: (value) => {
              if (!settling) pull = value;
            },
            onPullEnd: (value) => settle(value),
            onCancel: settle,
            feedback,
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

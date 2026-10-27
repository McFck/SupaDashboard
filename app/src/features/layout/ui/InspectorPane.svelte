<script lang="ts">
  import type { Snippet } from 'svelte';
  import PaneHandle from '../../../panel/ui/PaneHandle.svelte';
  import { frame, saveFrame } from '../../../panel/ui/preferences.svelte';
  import { inspectorWidth } from '../../../panel/ui/frame';

  /** Keyboard resize step in pixels. */
  const KEY_STEP = 16;

  let { active, width, children }: { active: boolean; width: number; children: Snippet } = $props();

  let resizing = $state<{ x: number; width: number } | null>(null);

  $effect(() => {
    if (!active && resizing) {
      resizing = null;
      saveFrame();
    }
  });

  function startResize(event: PointerEvent & { currentTarget: HTMLElement }) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizing = { x: event.clientX, width: frame.inspectorWidth };
  }

  function moveResize(event: PointerEvent) {
    if (active && resizing) {
      frame.inspectorWidth = inspectorWidth(resizing.width + resizing.x - event.clientX);
    }
  }

  function stopResize() {
    if (active && resizing) {
      resizing = null;
      saveFrame();
    }
  }

  function resizeWithKeys(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const step = event.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP;
    frame.inspectorWidth = inspectorWidth(frame.inspectorWidth + step);
    saveFrame();
  }
</script>

<svelte:window
  onpointermove={moveResize}
  onpointerup={stopResize}
  onpointercancel={stopResize}
  onblur={stopResize}
/>

<div
  class="right-slot relative min-h-0 shrink-0 overflow-visible"
  class:resizing={resizing !== null}
  class:inactive={!active}
  style:width="{frame.inspectorOpen ? width : 0}px"
>
  <PaneHandle
    label="Resize inspector"
    active={resizing !== null}
    class="bottom-0 -left-1.5 top-0"
    onpointerdown={startResize}
    onkeydown={resizeWithKeys}
  />
  <section
    aria-label="Inspector"
    aria-hidden={!frame.inspectorOpen}
    inert={!frame.inspectorOpen}
    style:width="{width}px"
    style:display={frame.inspectorOpen ? undefined : 'none'}
    class="right-panel absolute -top-12 bottom-0 left-0 z-10 flex min-h-0 flex-col overflow-hidden bg-sidebar"
    class:open={frame.inspectorOpen}
  >
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-y-0 left-0 z-10 w-px bg-[#262626]"
    ></div>
    <div class="inspector-content min-h-0 flex-1 overflow-hidden">
      {@render children()}
    </div>
  </section>
</div>

<style>
  /* shadcn Sidebar style: the slot animates its width and the panel rides its left edge, so it slides in and out. */
  .right-slot {
    transition: width 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .right-slot.inactive,
  .right-slot.resizing {
    transition: none;
  }
  .inspector-content :global(aside) {
    min-height: 0;
    overflow: hidden;
  }
  @media (prefers-reduced-motion: reduce) {
    .right-slot {
      transition: none;
    }
  }
</style>

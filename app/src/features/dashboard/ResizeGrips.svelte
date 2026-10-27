<script lang="ts">
  import { isTauri } from '@tauri-apps/api/core';
  import type { DashboardWindow } from './dashboard-window.svelte';

  const GRIPS = [
    { direction: 'NorthWest', position: 'top-0 left-0 size-8', cursor: 'cursor-nwse-resize' },
    { direction: 'North', position: 'top-0 left-8 right-8 h-2.5', cursor: 'cursor-ns-resize' },
    { direction: 'NorthEast', position: 'top-0 right-0 size-8', cursor: 'cursor-nesw-resize' },
    { direction: 'East', position: 'right-0 top-8 bottom-8 w-2.5', cursor: 'cursor-ew-resize' },
    { direction: 'SouthEast', position: 'bottom-0 right-0 size-8', cursor: 'cursor-nwse-resize' },
    { direction: 'South', position: 'bottom-0 left-8 right-8 h-2.5', cursor: 'cursor-ns-resize' },
    { direction: 'SouthWest', position: 'bottom-0 left-0 size-8', cursor: 'cursor-nesw-resize' },
    { direction: 'West', position: 'left-0 top-8 bottom-8 w-2.5', cursor: 'cursor-ew-resize' },
  ] as const;

  let { dashboard }: { dashboard: DashboardWindow } = $props();

  function startResize(event: PointerEvent, direction: (typeof GRIPS)[number]['direction']) {
    if (!isTauri() || event.button !== 0 || !event.isPrimary || dashboard.appliedFullscreen) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dashboard.startResize(direction);
  }
</script>

<div
  aria-hidden="true"
  class="resize-cues"
></div>
{#each GRIPS as grip (grip.direction)}
  <button
    type="button"
    data-resize-handle={grip.direction}
    aria-label="Resize window {grip.direction}"
    aria-roledescription="Window resize handle"
    class="absolute z-50 m-0 touch-none border-0 bg-transparent p-0 {grip.position} {grip.cursor}"
    onpointerdown={(event) => startResize(event, grip.direction)}
  ></button>
{/each}

<style>
  .resize-cues {
    position: absolute;
    z-index: 40;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1.5px var(--resize-ink);
    opacity: 0;
    transition: opacity 160ms ease-out;
  }

  :global(.dashboard-shell[data-hovered='true']) .resize-cues {
    --resize-ink: rgba(255, 255, 255, 0.32);
    opacity: 1;
    transition-duration: 120ms;
  }

  @media (prefers-reduced-motion: reduce) {
    .resize-cues,
    :global(.dashboard-shell[data-hovered='true']) .resize-cues {
      transition-duration: 0ms;
    }
  }

  @media (pointer: coarse) {
    .resize-cues {
      --resize-ink: rgba(255, 255, 255, 0.08);
    }
  }
</style>

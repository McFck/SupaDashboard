<script lang="ts">
  import type { DashboardWindow } from './dashboard-window.svelte';
  import band from './resize-band.json';

  let { dashboard }: { dashboard: DashboardWindow } = $props();
  const directions = [
    'NorthWest',
    'North',
    'NorthEast',
    'East',
    'SouthEast',
    'South',
    'SouthWest',
    'West',
  ] as const;

  function start(event: PointerEvent, direction: (typeof directions)[number]) {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dashboard.startResize(direction, event.pointerType);
  }
</script>

<div
  class="resize-grips"
  style:--band="{band.border}px"
  style:--corner="{band.corner}px"
>
  {#each directions as direction (direction)}
    <button
      type="button"
      data-resize-handle={direction}
      aria-label="Resize window {direction}"
      onpointerenter={dashboard.pointerEnter}
      onpointerleave={dashboard.pointerLeave}
      onpointerdown={(event) => start(event, direction)}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          dashboard.startResize(direction);
        }
      }}
    ></button>
  {/each}
</div>

<style>
  .resize-grips {
    position: fixed;
    inset: 0;
    z-index: 50;
    pointer-events: none;
  }
  button {
    position: absolute;
    pointer-events: auto;
    touch-action: none;
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
  }
  [data-resize-handle='North'],
  [data-resize-handle='South'] {
    left: var(--corner);
    right: var(--corner);
    height: var(--band);
    cursor: ns-resize;
  }
  [data-resize-handle='West'],
  [data-resize-handle='East'] {
    top: var(--corner);
    bottom: var(--corner);
    width: var(--band);
    cursor: ew-resize;
  }
  [data-resize-handle='NorthWest'],
  [data-resize-handle='NorthEast'],
  [data-resize-handle='SouthWest'],
  [data-resize-handle='SouthEast'] {
    /* Whole squares: the shell's rounded clip cuts away the outer corner, so a thin L would be almost unreachable. */
    width: var(--corner);
    height: var(--corner);
    cursor: nwse-resize;
  }
  [data-resize-handle^='North'] {
    top: 0;
  }
  [data-resize-handle^='South'] {
    bottom: 0;
  }
  [data-resize-handle$='West'] {
    left: 0;
  }
  [data-resize-handle$='East'] {
    right: 0;
  }
  [data-resize-handle='NorthEast'],
  [data-resize-handle='SouthWest'] {
    cursor: nesw-resize;
  }
</style>

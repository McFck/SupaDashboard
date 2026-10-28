<script lang="ts">
  import type { Page } from '../settings/schema';

  let {
    pages,
    currentId,
    onselect,
  }: { pages: Page[]; currentId: string; onselect: (pageId: string) => void } = $props();
</script>

<nav
  class="dashboard-page-dots"
  aria-label="Pages"
>
  {#each pages as page (page.id)}
    <button
      type="button"
      aria-label="Go to {page.name}"
      aria-current={currentId === page.id ? 'page' : undefined}
      class:dashboard-page-dot-active={currentId === page.id}
      onpointerdown={(event) => event.preventDefault()}
      onclick={() => onselect(page.id)}
    >
      <span aria-hidden="true"></span>
    </button>
  {/each}
</nav>

<style>
  .dashboard-page-dots {
    position: absolute;
    z-index: 30;
    left: 50%;
    bottom: 5px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 2px;
    max-width: calc(100% - 24px);
    overflow-x: auto;
    overflow-y: hidden;
    transform: translateX(-50%);
    scrollbar-width: none;
    -ms-overflow-style: none;
    touch-action: pan-x;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease-out;
  }

  :global(.dashboard-shell[data-hovered='true']) .dashboard-page-dots,
  .dashboard-page-dots:focus-within {
    opacity: 1;
    pointer-events: auto;
  }

  .dashboard-page-dots::-webkit-scrollbar {
    display: none;
  }

  button {
    display: grid;
    flex: 0 0 24px;
    width: 24px;
    height: 24px;
    place-items: center;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }

  span {
    display: block;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.42);
    opacity: 0.72;
    transition: opacity 120ms ease-out;
  }

  .dashboard-page-dot-active span {
    background: rgba(255, 255, 255, 0.95);
    opacity: 1;
  }

  @media (pointer: coarse) {
    .dashboard-page-dots {
      opacity: 1;
      pointer-events: auto;
    }
  }
</style>

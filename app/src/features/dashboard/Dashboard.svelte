<script lang="ts">
  // The dashboard window: transparent and frameless; a colour backdrop, or the native wallpaper window below it,
  // sits behind the applet.
  import { onMount, tick } from 'svelte';
  import { isTauri } from '@tauri-apps/api/core';
  import AppletHost from '../applets/AppletHost.svelte';
  import { appletFor } from '../applets/deck';
  import { settings } from '../settings/state.svelte';
  import { pageById, swipeablePages } from '../layout/pages';
  import { runtimeView } from '../../app/runtime/state';
  import { setMediaContentPages } from '../media/content-visibility';
  import { runtimeCommands } from '../../app/runtime/commands';
  import { DashboardWindow } from './dashboard-window.svelte';
  import { DashboardCursor } from './dashboard-cursor.svelte';
  import { DragGaps } from './drag-gaps.svelte';
  import { pageOffset } from './page-motion';
  import { Pager } from './pager.svelte';
  import PageDots from './PageDots.svelte';
  import ResizeGrips from './ResizeGrips.svelte';

  const { requestPageChange } = runtimeCommands;

  const page = $derived(
    pageById(settings.deck.pages, $runtimeView.activePage || settings.deck.activePage)!,
  );
  const bg = $derived(settings.display.background);
  const carouselPages = $derived(swipeablePages(settings.deck.pages));
  const pagerPages = $derived(
    carouselPages.some((candidate) => candidate.id === page.id) ? carouselPages : [page],
  );
  const showDots = $derived(carouselPages.length > 1);

  let shell: HTMLDivElement;
  let pageHost: HTMLDivElement;
  let gaps = $state<DragGaps>();
  let cursor = $state<DashboardCursor>();

  const dashboard = new DashboardWindow(
    () => settings.display,
    () => ({ page: $state.snapshot(page), bottomInset: showDots ? 34 : 0 }),
  );
  const pager = new Pager({
    shell: () => shell,
    pages: () => pagerPages,
    pageId: () => page.id,
    fullscreen: () => dashboard.appliedFullscreen,
    canDragWindow: () => isTauri() && !dashboard.appliedFullscreen,
    startWindowDrag: (pointerType) => dashboard.startDrag(pointerType),
    requestPage: (pageId) => requestPageChange({ page: pageId }, 'swipe'),
    onSettled: () => {
      gaps?.observeNodes();
      gaps?.schedule();
    },
    onChanged: () => gaps?.schedule(),
  });

  $effect(() => {
    setMediaContentPages(
      pager.frames.filter((frame) => frame.mediaVisible).map((frame) => frame.id),
    );
  });

  onMount(() => {
    const dashboardCursor = new DashboardCursor(document.documentElement);
    cursor = dashboardCursor;
    pager.start();
    const resize = () => pager.resize();
    window.addEventListener('resize', resize);
    document.addEventListener('fullscreenchange', resize);
    const dragGaps = new DragGaps(shell, pageHost, () => pager.busy);
    gaps = dragGaps;
    dashboard.start();

    return () => {
      dashboardCursor.destroy();
      dashboard.destroy();
      pager.destroy();
      setMediaContentPages([]);
      dragGaps.destroy();
      window.removeEventListener('resize', resize);
      document.removeEventListener('fullscreenchange', resize);
    };
  });

  // The page changed from outside a swipe (dots, actions, another window) or the page order, applet or
  // fullscreen state changed.
  $effect(() => {
    pager.reconcile(page.id);
  });

  // The visible page's geometry or placements changed: the drag areas move with them.
  $effect(() => {
    const active = page;
    void dashboard.appliedFullscreen;
    void [active.id, active.cols, active.rows, active.size, active.gap, active.sizing];
    for (const item of active.items) {
      void [item.x, item.y, item.w, item.h];
    }
    if (gaps) {
      void tick().then(() => gaps?.schedule());
    }
  });

  // Display policy changes are serialized; backdrop edits stay outside native window effects.
  $effect(() => {
    void [settings.display.monitor, settings.display.fullscreen, settings.display.alwaysOnTop];
    dashboard.requestChanged();
  });

  $effect(() => {
    void [bg.mode, bg.radius];
    dashboard.backdropChanged();
  });

  $effect(() => {
    void [page.id, page.cols, page.rows, page.gap, showDots];
    dashboard.gridChanged();
  });

  function goToPage(pageId: string) {
    void requestPageChange({ page: pageId }, 'dot').catch((error) =>
      console.warn('page navigation', error),
    );
  }
</script>

<div
  role="region"
  aria-label="Dashboard"
  class="dashboard-shell relative h-full w-full overflow-hidden"
  data-fullscreen={dashboard.appliedFullscreen}
  data-hovered={dashboard.showChrome}
  data-cursor={cursor?.visible ? 'mouse' : 'hidden'}
  style:border-radius="{dashboard.appliedFullscreen ? 0 : bg.radius}px"
  bind:this={shell}
  onpointerdowncapture={pager.pointerDown}
  onpointerenter={dashboard.pointerEnter}
  onpointerleave={dashboard.pointerLeave}
>
  {#if bg.mode === 'color'}
    <div
      aria-hidden="true"
      class="dashboard-backdrop"
      style:background={bg.color}
      style:opacity={Number.isFinite(bg.opacity) ? Math.max(0, Math.min(1, bg.opacity)) : 0}
    ></div>
  {/if}
  <div
    class="dashboard-applet"
    bind:this={pageHost}
  >
    <div class="dashboard-pages">
      {#each pager.frames as frame (frame.id)}
        {@const framePage = settings.deck.pages.find((candidate) => candidate.id === frame.id)}
        {#if framePage}
          <div
            class="dashboard-page-frame"
            class:dashboard-page-inactive={!frame.active}
            class:dashboard-page-inset={showDots && !framePage.applet}
            data-visible-page={frame.active ? 'true' : undefined}
            aria-hidden={!frame.active}
            inert={!frame.active}
            style:transform={pageOffset(frame.offset)}
            use:pager.motion.register={frame.id}
          >
            <AppletHost
              applet={appletFor(framePage)}
              page={framePage}
              visible={frame.active}
              pageRenderVisible={true}
            />
          </div>
        {/if}
      {/each}
    </div>
  </div>
  {#if showDots}
    <PageDots
      pages={carouselPages}
      currentId={page.id}
      onselect={goToPage}
    />
  {/if}
  {#if !pager.busy && gaps}
    {#each gaps.rects as gap, index (index)}
      <div
        aria-hidden="true"
        class="dashboard-drag-gap"
        style:left="{gap.x}px"
        style:top="{gap.y}px"
        style:width="{gap.width}px"
        style:height="{gap.height}px"
      ></div>
    {/each}
  {/if}
  {#if !dashboard.appliedFullscreen}
    <div
      aria-hidden="true"
      class="resize-cues"
    ></div>
  {/if}
</div>
<!-- Outside the shell so its rounded clip cannot cut the corner grips away. -->
{#if !dashboard.appliedFullscreen}
  <ResizeGrips {dashboard} />
{/if}

<style>
  :global(body:has(.dashboard-shell[data-cursor='hidden'])),
  :global(body:has(.dashboard-shell[data-cursor='hidden']) *) {
    cursor: none !important;
  }

  :global(.dashboard-shell),
  :global(.dashboard-shell *) {
    -webkit-app-region: no-drag;
  }

  .dashboard-shell {
    isolation: isolate;
    --resize-ink: rgba(255, 255, 255, 0.15);
  }

  /* Dragged through startDragging: WebView2's app-region never moved this no-activate window and swallowed the press. */
  .dashboard-drag-gap {
    position: absolute;
    z-index: 20;
    touch-action: none;
  }

  .dashboard-backdrop {
    position: absolute;
    z-index: 0;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
  }

  .dashboard-applet {
    position: absolute;
    z-index: 10;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .dashboard-pages,
  .dashboard-page-frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .dashboard-pages {
    overflow: hidden;
    contain: layout paint;
  }

  .dashboard-page-frame {
    will-change: transform;
  }

  /* Deck pages leave room for the page dots; applet pages run to the bottom edge and the dots float over them. */
  .dashboard-page-inset {
    box-sizing: border-box;
    padding-bottom: 34px;
  }

  .dashboard-page-inactive {
    pointer-events: none;
  }

  /* Shared by the DOM grips and the native border. */
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

  .dashboard-shell[data-hovered='true'] .resize-cues {
    --resize-ink: rgba(255, 255, 255, 0.32);
    opacity: 1;
    transition-duration: 120ms;
  }

  @media (prefers-reduced-motion: reduce) {
    .resize-cues,
    .dashboard-shell[data-hovered='true'] .resize-cues {
      transition-duration: 0ms;
    }
  }

  @media (pointer: coarse) {
    .resize-cues {
      --resize-ink: rgba(255, 255, 255, 0.08);
    }
  }
</style>

<script lang="ts">
  // The dashboard window: transparent and frameless; a configurable backdrop sits behind the skin.
  import { onMount, tick } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { isTauri } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { applyDisplay, complementRectangles, getAppliedFullscreen, initDisplay, type LocalRect } from './core/display';
  import { skins } from './core/registry';
  import { settings } from './core/settings.svelte';
  import { pageById } from './core/pages';
import { runtimeView, setRuntimeInteraction } from './core/runtime.svelte';

  type DisplayRequest = { monitor: string | null; fullscreen: boolean; alwaysOnTop: boolean };
  type HoverEvent = { hovered: boolean; revision: number; clearClient?: boolean };
  const Skin = $derived((skins.get(settings.skin) ?? skins.get('deck')!).component);
  const page = $derived(pageById(settings.deck.pages, $runtimeView.activePage || settings.deck.activePage)!);
  const bg = $derived(settings.display.background);
  let shell: HTMLDivElement;
  let skinRoot: HTMLDivElement;
  let dragGaps = $state<LocalRect[]>([]);
  let gapFrame = 0;
  let gapResizeObserver: ResizeObserver | undefined;
  let gapMutationObserver: MutationObserver | undefined;
  let observedGapNodes = new Set<Element>();
  let ready = $state(false);
  let appliedFullscreen = $state(false);
  let domHovered = $state(false);
  let nativeHovered = $state(false);
  let nativeHoverRevision = -1;
  let lastSuccessfulRequest: DisplayRequest | null = null;
  let lastFailedRequest: DisplayRequest | null = null;
  let draining = false;
  let disposed = false;
  let cleanupDisplay: (() => void) | undefined;
  let cleanupHover: (() => void) | undefined;
  let cleanupResized: (() => void) | undefined;
  const hovered = $derived(domHovered || nativeHovered);
  // Native resize loops swallow pointer hover, so keep the edge cues up until resize events go quiet.
  let windowResizing = $state(false);
  let resizeQuiet: ReturnType<typeof setTimeout> | undefined;
  function showResizeCues() {
    windowResizing = true;
    clearTimeout(resizeQuiet);
    resizeQuiet = setTimeout(() => { windowResizing = false; }, 400);
  }
  const sameRequest = (a: DisplayRequest | null, b: DisplayRequest) =>
    !!a && a.monitor === b.monitor && a.fullscreen === b.fullscreen && a.alwaysOnTop === b.alwaysOnTop;
  const currentRequest = (): DisplayRequest => ({
    monitor: settings.display.monitor,
    fullscreen: settings.display.fullscreen,
    alwaysOnTop: settings.display.alwaysOnTop,
  });
  const grips = [
    { direction: 'NorthWest', position: 'top-0 left-0 size-6 clip-northwest', cursor: 'cursor-nwse-resize' },
    { direction: 'North', position: 'top-0 left-6 right-6 h-[6px]', cursor: 'cursor-ns-resize' },
    { direction: 'NorthEast', position: 'top-0 right-0 size-6 clip-northeast', cursor: 'cursor-nesw-resize' },
    { direction: 'East', position: 'right-0 top-6 bottom-6 w-[6px]', cursor: 'cursor-ew-resize' },
    { direction: 'SouthEast', position: 'bottom-0 right-0 size-6 clip-southeast', cursor: 'cursor-nwse-resize' },
    { direction: 'South', position: 'bottom-0 left-6 right-6 h-[6px]', cursor: 'cursor-ns-resize' },
    { direction: 'SouthWest', position: 'bottom-0 left-0 size-6 clip-southwest', cursor: 'cursor-nesw-resize' },
    { direction: 'West', position: 'left-0 top-6 bottom-6 w-[6px]', cursor: 'cursor-ew-resize' },
  ] as const;

  function measureDragGaps() {
    if (!shell || !skinRoot || appliedFullscreen) {
      dragGaps = [];
      return;
    }
    const surface = shell.getBoundingClientRect();
    const excluded: LocalRect[] = [];
    const add = (node: Element) => {
      const bounds = node.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const rect = { x: bounds.left - surface.left, y: bounds.top - surface.top, width: bounds.width, height: bounds.height };
      if (excluded.some(outer => rect.x >= outer.x && rect.y >= outer.y &&
        rect.x + rect.width <= outer.x + outer.width && rect.y + rect.height <= outer.y + outer.height)) return;
      excluded.push(rect);
    };
    skinRoot.querySelectorAll('[data-dashboard-tile]').forEach(add);
    skinRoot.querySelectorAll('.tile, button, input, select, textarea, a, [contenteditable], [role="slider"]').forEach(add);
    dragGaps = complementRectangles(surface.width, surface.height, excluded, window.devicePixelRatio || 1);
  }

  function scheduleDragGapMeasure() {
    if (gapFrame || appliedFullscreen || !shell) return;
    gapFrame = requestAnimationFrame(() => {
      gapFrame = 0;
      measureDragGaps();
    });
  }

  function observeGapNodes() {
    if (!gapResizeObserver || !skinRoot) return;
    const next = new Set<Element>([skinRoot]);
    skinRoot.querySelectorAll('[data-dashboard-tile], .tile, button, input, select, textarea, a, [contenteditable], [role="slider"]')
      .forEach(node => next.add(node));
    for (const node of observedGapNodes) if (!next.has(node)) gapResizeObserver.unobserve(node);
    for (const node of next) if (!observedGapNodes.has(node)) gapResizeObserver.observe(node);
    observedGapNodes = next;
  }

  async function drainDisplay() {
    if (!ready || disposed || draining) return;
    draining = true;
    try {
      while (!disposed) {
        const display = $state.snapshot(settings.display);
        const request = { monitor: display.monitor, fullscreen: display.fullscreen, alwaysOnTop: display.alwaysOnTop };
        if (sameRequest(lastSuccessfulRequest, request) || sameRequest(lastFailedRequest, request)) break;
        try {
          const fullscreen = await applyDisplay(display, lastSuccessfulRequest?.monitor !== request.monitor);
          if (disposed) break;
          appliedFullscreen = fullscreen;
          lastSuccessfulRequest = request;
          lastFailedRequest = null;
        } catch (error) {
          if (!disposed) console.warn('display', error);
          lastFailedRequest = request;
          break;
        }
        if (sameRequest(currentRequest(), request)) break;
      }
    } finally {
      draining = false;
      const latest = currentRequest();
      if (!disposed && ready && !sameRequest(lastSuccessfulRequest, latest) && !sameRequest(lastFailedRequest, latest)) {
        queueMicrotask(() => void drainDisplay());
      }
    }
  }

  onMount(() => {
    disposed = false;
    const activePointers = new Set<number>();
    const pointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || !shell.contains(event.target as Node)) return;
      activePointers.add(event.pointerId);
      setRuntimeInteraction(true);
    };
    const pointerEnd = (event: PointerEvent) => {
      if (activePointers.delete(event.pointerId) && !activePointers.size) setRuntimeInteraction(false);
    };
    const clearInteractions = () => { activePointers.clear(); setRuntimeInteraction(false); };
    window.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('pointerup', pointerEnd, true);
    window.addEventListener('pointercancel', pointerEnd, true);
    window.addEventListener('blur', clearInteractions);
    gapResizeObserver = new ResizeObserver(scheduleDragGapMeasure);
    gapResizeObserver.observe(shell);
    observeGapNodes();
    gapMutationObserver = new MutationObserver(() => {
      observeGapNodes();
      scheduleDragGapMeasure();
    });
    gapMutationObserver.observe(skinRoot, { childList: true, subtree: true });
    scheduleDragGapMeasure();
    const initialDisplay = $state.snapshot(settings.display);
    let cleanup: (() => void) | undefined;

    const reveal = async () => {
      ready = true;
      await tick();
      if (!disposed && isTauri()) await getCurrentWindow().show();
    };

    void (async () => {
      if (isTauri()) {
        try {
          const stopResized = await getCurrentWindow().onResized(() => { if (ready && !appliedFullscreen) showResizeCues(); });
          cleanupResized = stopResized;
          cleanupHover = await listen<HoverEvent>('dashboard-hover', event => {
            const payload = event.payload;
            if (disposed || !Number.isSafeInteger(payload.revision) || payload.revision <= nativeHoverRevision) return;
            nativeHoverRevision = payload.revision;
            nativeHovered = payload.hovered === true;
            if (payload.clearClient) domHovered = false;
          });
        } catch (error) {
          console.warn('dashboard hover listener', error);
        }
      }
      try {
        cleanup = await initDisplay(initialDisplay, $state.snapshot(page), () => disposed);
        if (disposed) {
          cleanup?.();
          return;
        }
        appliedFullscreen = getAppliedFullscreen();
        lastSuccessfulRequest = { monitor: initialDisplay.monitor, fullscreen: appliedFullscreen, alwaysOnTop: initialDisplay.alwaysOnTop };
      } catch (error) {
        if (disposed) return;
        console.warn('display initialization failed; showing the safe dashboard window', error);
        appliedFullscreen = false;
        lastFailedRequest = { monitor: initialDisplay.monitor, fullscreen: initialDisplay.fullscreen, alwaysOnTop: initialDisplay.alwaysOnTop };
      }
      if (disposed) {
        cleanup?.();
        cleanupHover?.();
        cleanupResized?.();
        return;
      }
      cleanupDisplay = cleanup;
      await reveal();
      void drainDisplay();
    })().catch(error => console.warn('dashboard reveal failed', error));

    return () => {
      disposed = true;
      if (gapFrame) cancelAnimationFrame(gapFrame);
      gapResizeObserver?.disconnect();
      gapMutationObserver?.disconnect();
      observedGapNodes.clear();
      gapResizeObserver = undefined;
      gapMutationObserver = undefined;
      cleanupDisplay?.();
      cleanupHover?.();
      cleanupResized?.();
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointerup', pointerEnd, true);
      window.removeEventListener('pointercancel', pointerEnd, true);
      window.removeEventListener('blur', clearInteractions);
      clearInteractions();
      clearTimeout(resizeQuiet);
      cleanup?.();
    };
  });

  $effect(() => {
    settings.skin;
    appliedFullscreen;
    const active = page;
    active.id; active.cols; active.rows; active.size; active.gap; active.sizing;
    for (const item of active.items) { item.x; item.y; item.w; item.h; }
    if (gapResizeObserver) void tick().then(scheduleDragGapMeasure);
  });

  // Display policy changes are serialized; backdrop edits stay outside native window effects.
  $effect(() => {
    const request = currentRequest();
    if (ready && !sameRequest(lastSuccessfulRequest, request) && !sameRequest(lastFailedRequest, request)) {
      void drainDisplay();
    }
  });
</script>

<div role="region" aria-label="Dashboard" class="dashboard-shell relative h-full w-full overflow-hidden" data-fullscreen={appliedFullscreen}
  data-hovered={hovered || windowResizing}
  style:border-radius="{appliedFullscreen ? 0 : bg.radius}px"
  bind:this={shell} onpointerenter={() => { domHovered = true; }} onpointerleave={() => { domHovered = false; }}>
  <div aria-hidden="true" class="dashboard-backdrop" style:background={bg.color}
    style:opacity={Number.isFinite(bg.opacity) ? Math.max(0, Math.min(1, bg.opacity)) : 0}></div>
  <div class="dashboard-skin" bind:this={skinRoot}>{#key page.id}<Skin {page} />{/key}</div>
  {#if !appliedFullscreen}
    {#each dragGaps as gap}
      <div aria-hidden="true" class="dashboard-drag-gap" style:left="{gap.x}px" style:top="{gap.y}px"
        style:width="{gap.width}px" style:height="{gap.height}px"
        onpointerdown={e => {
          if (!isTauri() || e.button !== 0 || !e.isPrimary) return;
          e.preventDefault();
          getCurrentWindow().startDragging().catch(err => console.warn('drag', err));
        }}></div>
    {/each}
    <div aria-hidden="true" class="resize-cues"></div>
    {#each grips as grip}
      <button type="button" data-resize-handle={grip.direction} aria-label="Resize window {grip.direction}"
        aria-roledescription="Window resize handle"
        class="absolute z-50 m-0 touch-none border-0 bg-transparent p-0 {grip.position} {grip.cursor}"
        onpointerdown={e => {
          if (!isTauri() || e.button !== 0 || !e.isPrimary || appliedFullscreen) return;
          e.preventDefault();
          e.stopPropagation();
          showResizeCues();
          getCurrentWindow().startResizeDragging(grip.direction).catch(err => console.warn('resize', err));
        }}></button>
    {/each}
  {/if}
</div>

<style>
  :global(.dashboard-shell),
  :global(.dashboard-shell *) {
    -webkit-app-region: no-drag;
  }

  :global(.dashboard-shell) {
    isolation: isolate;
    --resize-ink: rgba(255, 255, 255, .15);
  }

  /* Dragged through startDragging: WebView2's app-region never moved this no-activate window and swallowed the press. */
  :global(.dashboard-shell .dashboard-drag-gap) {
    position: absolute;
    z-index: 20;
  }

  :global(.dashboard-shell .resize-cues) {
    position: absolute;
    z-index: 40;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px var(--resize-ink);
    opacity: 0;
    transition: opacity 160ms ease-out;
  }

  :global(.dashboard-shell .dashboard-backdrop) {
    position: absolute;
    z-index: 0;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
  }

  :global(.dashboard-shell .dashboard-skin) {
    position: relative;
    z-index: 10;
    width: 100%;
    height: 100%;
  }

  :global(.dashboard-shell[data-hovered='true'] .resize-cues) {
    --resize-ink: rgba(255, 255, 255, .2);
    opacity: 1;
    transition-duration: 120ms;
  }

  :global(.dashboard-shell [data-resize-handle='NorthWest']) { clip-path: polygon(0 0, 100% 0, 100% 25%, 25% 25%, 25% 100%, 0 100%); }
  :global(.dashboard-shell [data-resize-handle='NorthEast']) { clip-path: polygon(0 0, 100% 0, 100% 100%, 75% 100%, 75% 25%, 0 25%); }
  :global(.dashboard-shell [data-resize-handle='SouthEast']) { clip-path: polygon(75% 0, 100% 0, 100% 100%, 0 100%, 0 75%, 75% 75%); }
  :global(.dashboard-shell [data-resize-handle='SouthWest']) { clip-path: polygon(0 0, 25% 0, 25% 75%, 100% 75%, 100% 100%, 0 100%); }

  @media (prefers-reduced-motion: reduce) {
    :global(.dashboard-shell .resize-cues),
    :global(.dashboard-shell[data-hovered='true'] .resize-cues) { transition-duration: 0ms; }
  }

  @media (pointer: coarse) {
    :global(.dashboard-shell .resize-cues) { --resize-ink: rgba(255, 255, 255, .08); opacity: 1; }
  }
</style>

<script lang="ts">
  import type { Component } from 'svelte';
  import { onDestroy } from 'svelte';
  import type { ControlConfig, ControlFaceProps, TilePresentation } from '../../controls/model';
  import { commit } from '../history.svelte';
  import {
    clampResizeRect,
    fits,
    fitDeck,
    inside,
    tileRadius,
    type FittedDeck,
    type Item,
    type Selection,
  } from '../grid';
  import {
    keyboardResizeDelta,
    resizeFromCornerHysteretic,
    resizeLimits,
    type ResizeCorner,
  } from '../drag-geometry';
  import { controlTypes } from '../../plugins/registry';
  import { controlById, settings } from '../../settings/state.svelte';
  import type { Page } from '../../settings/schema';
  import type { EffectiveSize, LayoutTarget } from '../skin-layouts';
  import { runtimeView } from '../../../app/runtime/state';
  import { registerRemovalNode, removeItem } from '../removal';
  import { DeckDrag } from './deck-drag.svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { TileMotion } from './tile-motion.svelte';
  import { RemovalChrome } from './removal-chrome.svelte';
  import DeckEditChrome from './DeckEditChrome.svelte';

  type GridLayout = Pick<Page, 'rows' | 'cols' | 'size' | 'sizing' | 'gap'> & { items: Item[] };
  type ContextTarget = { item: string } | { cell: { x: number; y: number } };

  let {
    page,
    layout,
    target,
    onitemschange,
    faceMap,
    compact = false,
    resolveSize,
    editorPreview = false,
    editing = false,
    selected = null,
    availableWidth,
    availableHeight,
    pageRenderVisible = false,
    resolvePresentation,
    onselect,
    oncontext,
  }: {
    page: Page;
    layout?: GridLayout;
    target?: LayoutTarget;
    onitemschange: (items: Item[]) => boolean;
    faceMap?: Record<string, Component<ControlFaceProps>>;
    compact?: boolean;
    resolveSize?: (typeId: string) => Pick<EffectiveSize, 'min' | 'max'> | undefined;
    editorPreview?: boolean;
    editing?: boolean;
    selected?: Selection;
    availableWidth?: number;
    availableHeight?: number;
    pageRenderVisible?: boolean;
    onselect?: (s: Selection, target?: LayoutTarget) => void;
    resolvePresentation?: (control: ControlConfig, variantIndex: number) => TilePresentation;
    oncontext?: (target: ContextTarget, x: number, y: number, layoutTarget?: LayoutTarget) => void;
  } = $props();

  const deck = $derived(layout ?? page);
  const targetKey = $derived(
    target ? `${target.skinId}/${target.pageId}/${target.slotId}` : `deck/${page.id}/main`,
  );
  const intrinsic: FittedDeck = $derived({
    cell: deck.size,
    gap: deck.gap,
    width: deck.cols * deck.size + (deck.cols + 1) * deck.gap,
    height: deck.rows * deck.size + (deck.rows + 1) * deck.gap,
  });
  let lastFit = $state<FittedDeck | null>(null);
  $effect(() => {
    if (availableWidth == null || availableHeight == null) {
      lastFit = null;
      return;
    }
    const fit = fitDeck(deck, availableWidth, availableHeight);
    if (fit && !sameFit(fit, lastFit)) {
      lastFit = fit;
    }
  });
  const metrics = $derived(
    availableWidth == null || availableHeight == null ? intrinsic : (lastFit ?? intrinsic),
  );
  const pitch = $derived(metrics.cell + metrics.gap);
  const items = $derived(
    deck.items.flatMap((item) => {
      if (!inside(item, deck)) {
        return [];
      }
      const control = controlById(item.control);
      const def = control && controlTypes.get(control.type);
      return control && def ? [{ item, control, def }] : [];
    }),
  );
  const selectedEntry = $derived(
    selected && 'item' in selected
      ? items.find((entry) => entry.item.id === selected.item)
      : undefined,
  );

  let grid = $state<HTMLElement>();
  const tileNodes = new Map<string, HTMLElement>();
  const motion = new TileMotion();
  const chrome = new RemovalChrome();
  const drag = new DeckDrag({
    deck: () => deck,
    metrics: () => metrics,
    pitch: () => pitch,
    grid: () => grid,
    limits: (item, corner) => resizeLimits(item, corner, deck, typeLimits(item)),
    isRemoving: (id) => !!chrome.removing[id],
    layoutSignature,
    write: writeItems,
    select,
    motion,
  });
  const editingChromeHidden = $derived(!!drag.current?.moved || motion.anyElevated);

  function sameFit(a: FittedDeck, b: FittedDeck | null) {
    return (
      !!b && a.cell === b.cell && a.gap === b.gap && a.width === b.width && a.height === b.height
    );
  }

  function layoutSignature() {
    return JSON.stringify({ target: targetKey, items: deck.items });
  }

  function typeLimits(item: Item) {
    const typeId = controlById(item.control)?.type ?? '';
    const def = controlTypes.get(typeId);
    const size = resolveSize?.(typeId);
    return { min: size?.min ?? def?.minSize, max: size?.max ?? def?.maxSize };
  }

  function select(selection: Selection) {
    onselect?.(selection, target);
  }

  function writeItems(next: Item[], label: string) {
    commit(label);
    return onitemschange(next);
  }

  function openContextMenu(event: MouseEvent, selection: ContextTarget) {
    if (!editing || ('item' in selection && chrome.removing[selection.item])) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    drag.cancel();
    select(selection);
    oncontext?.(selection, event.clientX, event.clientY, target);
  }

  function startRemoval(id: string) {
    chrome.fadeOut(id);
    motion.stop(id);
    drag.interruptForRemoval(id);
  }

  function clearRemoval(id: string) {
    chrome.clear(id);
    drag.clearRemoval(id);
  }

  /** Svelte action for a tile's grid cell: removal animation, its cancellation, and context menu. */
  const registerTile = (node: HTMLElement, id: string) => {
    tileNodes.set(id, node);
    const removal = registerRemovalNode(node, id, {
      start: () => startRemoval(id),
      cancel: () => clearRemoval(id),
    });
    const menu = (event: MouseEvent) => openContextMenu(event, { item: id });
    node.addEventListener('contextmenu', menu);
    return {
      destroy() {
        tileNodes.delete(id);
        removal.destroy();
        clearRemoval(id);
        node.removeEventListener('contextmenu', menu);
      },
    };
  };

  function resizeKeydown(event: KeyboardEvent, item: Item, corner: ResizeCorner) {
    const delta = keyboardResizeDelta(event.key, event.shiftKey, pitch);
    if (!delta) {
      return;
    }
    event.preventDefault();
    const { min, max } = resizeLimits(item, corner, deck, typeLimits(item));
    const candidate = resizeFromCornerHysteretic(
      item,
      corner,
      delta.dx,
      delta.dy,
      pitch,
      item,
      min,
      max,
    );
    const obstacles = deck.items
      .filter((other) => other.id !== item.id)
      .map(({ x, y, w, h }) => ({ x, y, w, h }));
    const bounded = clampResizeRect(candidate, obstacles, corner, min);
    if (!bounded) {
      return;
    }
    const nextItem = { ...item, ...bounded };
    const unchanged = nextItem.w === item.w && nextItem.h === item.h;
    if (unchanged || !fits(deck.items, nextItem, deck, [item.id])) {
      return;
    }
    writeItems(
      deck.items.map((entry) => (entry.id === item.id ? { ...entry, ...nextItem } : entry)),
      'Resize widget',
    );
    select({ item: item.id });
  }

  // Layout changes cancel a drag in progress and animate the tiles they moved.
  let previousLayout = '';
  let previousGrid = '';
  let previousMetrics = '';
  let previousEditing = false;
  $effect.pre(() => {
    const dimensions = `${deck.rows}/${deck.cols}/${deck.size}/${deck.gap}/${deck.sizing}`;
    const pixels = `${metrics.cell}/${metrics.gap}/${metrics.width}/${metrics.height}/${availableWidth}/${availableHeight}`;
    const layout = `${targetKey}|${deck.items.map((i) => `${i.id}:${i.x},${i.y},${i.w},${i.h}`).join(';')}`;
    const selectedId = selected && 'item' in selected ? selected.item : '';
    const active = drag.current;
    const lostResizeSelection = active?.mode === 'resize' && selectedId !== active.id;
    const unchanged =
      layout === previousLayout &&
      dimensions === previousGrid &&
      pixels === previousMetrics &&
      editing === previousEditing;
    if (unchanged && !lostResizeSelection) {
      return;
    }

    const before = motion.measure();
    const layoutChanged = layout !== previousLayout || dimensions !== previousGrid;
    if (
      active &&
      (!editing || lostResizeSelection || layoutChanged || pixels !== previousMetrics)
    ) {
      drag.cancel(false);
    }
    const animate =
      previousLayout !== '' &&
      layout !== previousLayout &&
      dimensions === previousGrid &&
      pixels === previousMetrics;
    previousLayout = layout;
    previousGrid = dimensions;
    previousMetrics = pixels;
    previousEditing = editing;

    const scale = grid ? grid.getBoundingClientRect().width / grid.offsetWidth : 1;
    motion.invalidate();
    if (!animate || prefersReducedMotion.current) {
      return;
    }
    const ids = new Set(deck.items.map((item) => item.id));
    for (const id of tileNodes.keys()) {
      if (!ids.has(id)) {
        // Already deleted from the data; this only plays the dust while the tile unmounts.
        void removeItem(id, () => true);
      }
    }
    motion.animateFrom(before, scale);
  });

  onDestroy(() => {
    motion.invalidate();
    drag.destroy();
  });

  const isSelected = (selection: Selection, id: string) =>
    !!selection && 'item' in selection && selection.item === id;
  const isCell = (selection: Selection, x: number, y: number) =>
    !!selection && 'cell' in selection && selection.cell.x === x && selection.cell.y === y;
</script>

<div
  bind:this={grid}
  class="relative isolate grid"
  style:width="{metrics.width}px"
  style:height="{metrics.height}px"
  style:padding="{metrics.gap}px"
  style:gap="{metrics.gap}px"
  style:grid-template-columns="repeat({deck.cols}, {metrics.cell}px)"
  style:grid-template-rows="repeat({deck.rows}, {metrics.cell}px)"
  style:--tile-radius="{tileRadius(metrics.cell)}px"
>
  {#if editing}
    {#each { length: deck.rows * deck.cols }, i (i)}
      {@const x = i % deck.cols}
      {@const y = Math.floor(i / deck.cols)}
      <button
        data-empty-cell
        data-selected={isCell(selected, x, y)}
        aria-label="Empty spot {x + 1},{y + 1}"
        onclick={() => select({ cell: { x, y } })}
        oncontextmenu={(event) => openContextMenu(event, { cell: { x, y } })}
        style:grid-area="{y + 1} / {x + 1}"
        class="rounded-[var(--tile-radius,22px)] border transition-colors
          {isCell(selected, x, y) ? 'ring-2 ring-inset' : ''}"
      ></button>
    {/each}
  {/if}

  {#each items as { item, control, def } (item.id)}
    {@const active = drag.current}
    {@const resizing = active?.id === item.id && active.mode === 'resize' ? active : null}
    {@const renderItem = resizing ? resizing.validResize : item}
    {@const variantIndex = settings.variants[control.id] ?? 0}
    {@const pageVisible = !editorPreview && (editing || page.id === $runtimeView.activePage)}
    {@const pageRendered = !editorPreview && (editing || pageRenderVisible)}
    {@const presentation = resolvePresentation?.(control, variantIndex)}
    {@const lifted = active?.id === item.id && active.moved && active.mode === 'move'}
    {@const displaced =
      active?.mode === 'move' &&
      active.placement?.kind === 'swap' &&
      active.placement.displaced.includes(item.id)
        ? active.placement.items.find((entry) => entry.id === item.id)
        : null}
    {@const face = faceMap?.[control.type] ?? def.face}
    <div
      use:registerTile={item.id}
      inert={!!chrome.removing[item.id]}
      style:grid-area="{renderItem.y + 1} / {renderItem.x + 1} / span {renderItem.h} / span {renderItem.w}"
      class="relative min-h-0 min-w-0 {lifted
        ? 'z-40 cursor-grabbing opacity-90 drop-shadow-[0_20px_30px_rgba(0,0,0,.6)]'
        : motion.elevated[item.id]
          ? 'z-40'
          : 'z-10'}"
    >
      <div
        use:motion.register={item.id}
        data-dashboard-tile
        class="relative h-full w-full min-h-0 min-w-0"
        style:translate={lifted && active
          ? `${active.moveX}px ${active.moveY}px`
          : displaced
            ? `${(displaced.x - item.x) * pitch}px ${(displaced.y - item.y) * pitch}px`
            : null}
      >
        <div
          data-dashboard-tile
          class="h-full w-full"
          inert={editing}
        >
          <def.component
            {control}
            {page}
            pageId={page.id}
            {pageVisible}
            {pageRendered}
            w={renderItem.w}
            h={renderItem.h}
            pixelWidth={renderItem.w * pitch - metrics.gap}
            pixelHeight={renderItem.h * pitch - metrics.gap}
            {presentation}
            itemId={item.id}
            pressFeedbackDisabled={editing}
            {...face ? { face, compact } : {}}
          />
        </div>
        {#if editing}
          {#if isSelected(selected, item.id)}
            <div
              data-selection
              class="pointer-events-none absolute inset-0 rounded-[var(--tile-radius,22px)] ring-2 ring-inset ring-white/75"
            ></div>
          {/if}
          <div
            role="button"
            tabindex="0"
            aria-label="Move or select {control.name}"
            class="absolute inset-0 cursor-grab touch-none rounded-[var(--tile-radius,22px)] hover:bg-white/[.04]"
            onpointerdown={(event) => drag.begin(event, item, 'move')}
            onpointermove={(event) => drag.track(event, item)}
            onpointerup={(event) => drag.end(item, event)}
            onpointercancel={drag.cancelPointer}
            onlostpointercapture={drag.cancelPointer}
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                select({ item: item.id });
              }
            }}
          ></div>
        {/if}
      </div>
    </div>
  {/each}

  {#if editing}
    <DeckEditChrome
      {deck}
      selectedItem={selectedEntry?.item}
      selectedName={selectedEntry?.control.name ?? ''}
      {drag}
      {chrome}
      {pitch}
      gap={metrics.gap}
      hidden={editingChromeHidden}
      onresizekey={resizeKeydown}
    />
  {/if}
</div>

<style>
  :global([data-dashboard-tile]),
  :global([data-dashboard-tile] *) {
    -webkit-app-region: no-drag;
  }
</style>

<script lang="ts">
  import ResizeFrame from '../../controls/ui/ResizeFrame.svelte';
  import { inside, type Grid, type Item } from '../grid';
  import { itemBox, resizeCornerGeometry, type ResizeCorner } from '../drag-geometry';
  import type { DeckDrag } from './deck-drag.svelte';
  import type { RemovalChrome } from './removal-chrome.svelte';

  const CORNERS: readonly ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];
  const CORNER_STROKE: Record<ResizeCorner, string> = {
    nw: 'border-l-2 border-t-2 rounded-tl-sm',
    ne: 'border-r-2 border-t-2 rounded-tr-sm',
    se: 'border-r-2 border-b-2 rounded-br-sm',
    sw: 'border-l-2 border-b-2 rounded-bl-sm',
  };
  const CORNER_CURSOR: Record<ResizeCorner, string> = {
    nw: 'cursor-nwse-resize',
    se: 'cursor-nwse-resize',
    ne: 'cursor-nesw-resize',
    sw: 'cursor-nesw-resize',
  };

  let {
    deck,
    selectedItem,
    selectedName,
    drag,
    chrome,
    pitch,
    gap,
    hidden,
    onresizekey,
  }: {
    deck: Grid;
    selectedItem: Item | undefined;
    selectedName: string;
    drag: DeckDrag;
    chrome: RemovalChrome;
    pitch: number;
    gap: number;
    hidden: boolean;
    onresizekey: (event: KeyboardEvent, item: Item, corner: ResizeCorner) => void;
  } = $props();

  const current = $derived(drag.current);
  const activeMove = $derived(current?.mode === 'move' && current.moved ? current : null);
  const movePreview = $derived(activeMove ?? drag.removalMove);
  const owner = $derived(
    drag.removalMove?.id ??
      drag.removalResize?.id ??
      activeMove?.id ??
      (current?.mode === 'resize' ? current.id : (selectedItem?.id ?? '')),
  );
  const handleFrame = $derived.by(() => {
    if (!selectedItem) {
      return null;
    }
    const resizing = current?.id === selectedItem.id && current.mode === 'resize' ? current : null;
    if (resizing?.moved) {
      return resizing.ghost;
    }
    return itemBox(resizing ? resizing.validResize : selectedItem, pitch, gap);
  });
  const announcement = $derived.by(() => {
    if (current?.mode !== 'move' || !current.moved) {
      return '';
    }
    if (current.pending) {
      return 'Checking placement';
    }
    if (current.placement?.kind === 'swap') {
      return 'Swap';
    }
    return current.ok ? '' : 'Cannot place';
  });
</script>

{#if owner}
  <div
    use:chrome.register={owner}
    data-editing-chrome
    inert={!!chrome.removing[owner]}
    class="pointer-events-none absolute inset-0 z-[60]"
  >
    {#if movePreview?.id === owner && movePreview.pointerInside && inside(movePreview.target, deck)}
      {@const targetBox = itemBox(movePreview.target, movePreview.pitch, movePreview.gap)}
      {@const placement = movePreview.placement}
      {#if placement?.kind === 'swap'}
        {@const sourceBox = itemBox(movePreview.item, movePreview.pitch, movePreview.gap)}
        <div
          aria-hidden="true"
          class="pointer-events-none absolute left-0 top-0 z-20 box-border rounded-[22px] border border-dashed border-white/65 bg-white/[.025]"
          style:translate="{sourceBox.x}px {sourceBox.y}px"
          style:width="{sourceBox.width}px"
          style:height="{sourceBox.height}px"
        ></div>
        {#each placement.displaced as displacedId (displacedId)}
          {@const destination = placement.items.find((entry) => entry.id === displacedId)!}
          {@const destinationBox = itemBox(destination, movePreview.pitch, movePreview.gap)}
          <div
            data-displaced-destination
            aria-hidden="true"
            class="pointer-events-none absolute left-0 top-0 z-20 box-border rounded-[22px] border border-dashed border-emerald-300/80"
            style:translate="{destinationBox.x}px {destinationBox.y}px"
            style:width="{destinationBox.width}px"
            style:height="{destinationBox.height}px"
          ></div>
        {/each}
      {/if}
      <div
        data-placement-target
        class="pointer-events-none absolute left-0 top-0 z-30 box-border rounded-[22px] border
          {movePreview.pending
          ? 'border-white/40 bg-white/[.015]'
          : movePreview.ok
            ? 'border-emerald-400/70 bg-emerald-400/5'
            : 'border-red-400/70 bg-red-400/5'}"
        style:translate="{targetBox.x}px {targetBox.y}px"
        style:width="{targetBox.width}px"
        style:height="{targetBox.height}px"
      >
        {#if placement?.kind === 'swap'}
          <svg
            aria-hidden="true"
            class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-emerald-200"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 8h15m0 0-4-4m4 4-4 4M20 16H5m0 0 4 4m-4-4 4-4" />
          </svg>
        {:else if !movePreview.ok}
          <svg
            aria-hidden="true"
            class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-red-200"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        {/if}
      </div>
    {/if}
    {#if drag.frameBox}
      <ResizeFrame
        bind:this={drag.resizeFrame}
        x={drag.frameBox.x}
        y={drag.frameBox.y}
        width={drag.frameBox.width}
        height={drag.frameBox.height}
        preferredRadius={drag.frameRadius}
        invalid={drag.frameInvalid}
      />
    {/if}
    {#if selectedItem && handleFrame}
      {#each CORNERS as corner (corner)}
        {@const geometry = resizeCornerGeometry(handleFrame.width, handleFrame.height, corner)}
        {@const hitX = handleFrame.x + geometry.hitX}
        {@const hitY = handleFrame.y + geometry.hitY}
        <button
          type="button"
          data-corner={corner}
          aria-label="Resize {selectedName} {corner} corner"
          aria-hidden={hidden}
          tabindex={hidden ? -1 : 0}
          style:pointer-events={hidden ? 'none' : 'auto'}
          class="group pointer-events-auto absolute left-0 top-0 z-50 grid size-7 place-items-center touch-none bg-transparent text-white transition-opacity duration-100 {hidden
            ? 'opacity-0'
            : ''} {CORNER_CURSOR[
            corner
          ]} focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          style:translate="{hitX}px {hitY}px"
          onpointerdown={(event) => drag.begin(event, selectedItem, 'resize', corner)}
          onpointermove={(event) => drag.track(event, selectedItem)}
          onpointerup={(event) => drag.end(selectedItem, event)}
          onpointercancel={drag.cancelPointer}
          onlostpointercapture={drag.cancelPointer}
          onkeydown={(event) => onresizekey(event, selectedItem, corner)}
        >
          <span
            aria-hidden="true"
            class="pointer-events-none absolute left-0 top-0 z-50 h-3 w-3 border-current opacity-65 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100 {CORNER_STROKE[
              corner
            ]}"
            style:translate="{handleFrame.x + geometry.strokeX - hitX}px {handleFrame.y +
              geometry.strokeY -
              hitY}px"
          ></span>
        </button>
      {/each}
    {/if}
  </div>
{/if}
<span
  class="sr-only"
  aria-live="polite"
  aria-atomic="true"
>
  {announcement}
</span>

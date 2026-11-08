<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { Hint } from '$lib/components/ui/tooltip';
  import ContextMenu, { type MenuAction } from '../../../panel/ui/ContextMenu.svelte';
  import { MAX_PAGES } from '../pages';
  import { sortable } from '$lib/sortable/sortable';
  import type { Page } from '../../settings/schema';

  type StripPan = { pointerId: number; startX: number; startScroll: number };

  let {
    pages,
    selectedPageId = $bindable(),
    onadd,
    onreorder,
    onrename,
    onduplicate,
    ondelete,
    active = true,
  }: {
    pages: Page[];
    selectedPageId: string;
    onadd: () => void;
    onreorder: (pageId: string, index: number) => void;
    onrename: (pageId: string, name: string) => boolean;
    onduplicate: (pageId: string) => void;
    ondelete: (pageId: string) => void;
    active?: boolean;
  } = $props();
  let list = $state<HTMLElement | null>(null);
  let stripPan = $state<StripPan | null>(null);
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);
  let renameOpen = $state(false);
  let renamePageId = $state('');
  let renameDraft = $state('');
  let pageMenu = $state<{ x: number; y: number; actions: MenuAction[]; generation: number } | null>(
    null,
  );
  let pageMenuOpen = $state(false);
  let pageMenuGeneration = 0;

  function updateScrollFade() {
    if (!list) {
      canScrollLeft = false;
      canScrollRight = false;
      return;
    }
    const maximum = Math.max(0, list.scrollWidth - list.clientWidth);
    canScrollLeft = list.scrollLeft > 1;
    canScrollRight = list.scrollLeft < maximum - 1;
  }

  function scrollTabIntoView(pageId: string, pageList = list) {
    if (!pageList) return;
    const tab = [...pageList.querySelectorAll<HTMLButtonElement>('[data-page-tab]')].find(
      (button) => button.dataset.pageTab === pageId,
    );
    if (!tab) return;
    const listRect = pageList.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const tabLeft = tabRect.left - listRect.left + pageList.scrollLeft;
    const tabRight = tabLeft + tabRect.width;
    const visibleLeft = pageList.scrollLeft;
    const visibleRight = visibleLeft + pageList.clientWidth;
    if (tabLeft < visibleLeft) pageList.scrollLeft = Math.max(0, tabLeft);
    else if (tabRight > visibleRight)
      pageList.scrollLeft = Math.min(
        pageList.scrollWidth - pageList.clientWidth,
        tabRight - pageList.clientWidth,
      );
    updateScrollFade();
  }

  function cancelStripPan() {
    const current = stripPan;
    if (!current) return;
    stripPan = null;
    if (list?.hasPointerCapture(current.pointerId)) list.releasePointerCapture(current.pointerId);
  }

  function beginStripPan(event: PointerEvent) {
    if (
      event.target !== list ||
      !list ||
      list.hasAttribute('data-sorting') ||
      event.pointerType === 'touch' ||
      event.button !== 0 ||
      list.scrollWidth <= list.clientWidth
    )
      return;
    event.preventDefault();
    stripPan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: list.scrollLeft,
    };
    list.setPointerCapture(event.pointerId);
  }

  function moveStripPan(event: PointerEvent) {
    const current = stripPan;
    if (!current || current.pointerId !== event.pointerId || !list) return;
    list.scrollLeft = current.startScroll - (event.clientX - current.startX);
    updateScrollFade();
  }

  function finishStripPan(event: PointerEvent) {
    if (stripPan?.pointerId !== event.pointerId) return;
    cancelStripPan();
  }

  function wheelTabs(event: WheelEvent) {
    if (!list || list.scrollWidth <= list.clientWidth) return;
    if (list.hasAttribute('data-sorting')) {
      if (event.cancelable) event.preventDefault();
      return;
    }
    const delta = event.deltaY || event.deltaX;
    if (!delta) return;
    list.scrollLeft += delta;
    updateScrollFade();
    if (event.cancelable) event.preventDefault();
  }

  function cancelPointer(event: PointerEvent) {
    if (stripPan?.pointerId === event.pointerId) cancelStripPan();
  }

  function tabItems() {
    return [...(list?.querySelectorAll<HTMLElement>('[data-page-tab]') ?? [])];
  }
  function moveTab(from: number, to: number) {
    const page = pages[from];
    if (page) onreorder(page.id, to);
  }

  function openRename(pageId: string) {
    const page = pages.find((entry) => entry.id === pageId);
    if (!page) return;
    selectedPageId = page.id;
    renamePageId = page.id;
    renameDraft = page.name;
    renameOpen = true;
  }

  function closePageMenu(generation: number) {
    if (pageMenu?.generation === generation) pageMenuOpen = false;
  }

  function openPageMenu(event: MouseEvent, page: Page) {
    event.preventDefault();
    const generation = ++pageMenuGeneration;
    pageMenu = {
      x: event.clientX,
      y: event.clientY,
      generation,
      actions: [
        { label: 'Rename', run: () => openRename(page.id) },
        {
          label: 'Duplicate',
          disabled: pages.length >= MAX_PAGES,
          run: () => onduplicate(page.id),
        },
        {
          label: 'Delete',
          disabled: pages.length <= 1,
          danger: true,
          run: () => ondelete(page.id),
        },
      ],
    };
    pageMenuOpen = true;
  }

  function saveRename() {
    if (onrename(renamePageId, renameDraft)) renameOpen = false;
  }

  function keydown(event: KeyboardEvent, page: Page, index: number) {
    if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const next = index + (event.key === 'ArrowLeft' ? -1 : 1);
      if (next < 0 || next >= pages.length) return;
      event.preventDefault();
      onreorder(page.id, next);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next =
      event.key === 'ArrowLeft'
        ? (index + pages.length - 1) % pages.length
        : event.key === 'ArrowRight'
          ? (index + 1) % pages.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? pages.length - 1
              : index;
    if (next === index) return;
    event.preventDefault();
    selectedPageId = pages[next].id;
    list?.querySelectorAll<HTMLButtonElement>('[data-page-tab]')[next]?.focus();
  }

  $effect(() => {
    if (selectedPageId !== renamePageId && renameOpen) renameOpen = false;
  });

  $effect(() => {
    const pageList = list;
    if (!pageList) return;
    const resizeObserver = new ResizeObserver(() => {
      updateScrollFade();
      if (selectedPageId) scrollTabIntoView(selectedPageId, pageList);
    });
    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLButtonElement && node.matches('[data-page-tab]'))
            resizeObserver.observe(node);
        }
      }
      updateScrollFade();
    });
    resizeObserver.observe(pageList);
    pageList
      .querySelectorAll<HTMLButtonElement>('[data-page-tab]')
      .forEach((button) => resizeObserver.observe(button));
    mutationObserver.observe(pageList, { childList: true, characterData: true, subtree: true });
    const frame = requestAnimationFrame(updateScrollFade);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  });

  $effect(() => {
    const selectedId = selectedPageId;
    const pageList = list;
    if (!selectedId || !pageList) return;
    let cancelled = false;
    let frame: number | undefined;
    void tick().then(() => {
      if (cancelled || selectedId !== selectedPageId || pageList !== list) return;
      frame = requestAnimationFrame(() => {
        if (selectedId !== selectedPageId || pageList !== list) return;
        scrollTabIntoView(selectedId, pageList);
      });
    });
    return () => {
      cancelled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  });

  onDestroy(cancelStripPan);
</script>

<svelte:window
  onpointermove={moveStripPan}
  onpointerup={finishStripPan}
  onpointercancel={cancelPointer}
  onblur={cancelStripPan}
/>
<div
  class="flex h-12 min-h-12 min-w-0 flex-1 shrink-0 flex-nowrap items-center gap-1.5 overflow-hidden"
>
  <div
    bind:this={list}
    use:sortable={{ axis: 'x', enabled: active, items: tabItems, onmove: moveTab }}
    role="tablist"
    aria-label="Pages"
    tabindex="-1"
    onscroll={updateScrollFade}
    onwheel={wheelTabs}
    onpointerdown={beginStripPan}
    onlostpointercapture={(event) => {
      if (stripPan?.pointerId === event.pointerId) cancelStripPan();
    }}
    class:fade-left={canScrollLeft}
    class:fade-right={canScrollRight}
    class="page-tab-strip flex h-full min-w-0 flex-initial flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden whitespace-nowrap touch-pan-x"
  >
    {#each pages as page, index (page.id)}
      <button
        type="button"
        role="tab"
        aria-selected={page.id === selectedPageId}
        tabindex={page.id === selectedPageId ? 0 : -1}
        data-page-tab={page.id}
        onkeydown={(event) => keydown(event, page, index)}
        onclick={() => (selectedPageId = page.id)}
        oncontextmenu={(event) => openPageMenu(event, page)}
        class="h-9 min-w-20 max-w-40 shrink-0 select-none truncate rounded-md px-3 font-display text-sm font-medium tracking-wide text-foreground/70 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-muted/70 aria-selected:text-foreground touch-none"
      >
        {page.name}
      </button>
    {/each}
  </div>
  <Hint
    text="Add page"
    side="bottom"
    >{#snippet children(props)}<Button
        {...props}
        data-page-action
        variant="ghost"
        size="icon-sm"
        aria-label="Add page"
        disabled={pages.length >= MAX_PAGES}
        onclick={onadd}><Plus /></Button
      >{/snippet}</Hint
  >
</div>

{#each pageMenuOpen && pageMenu ? [pageMenu] : [] as menu (menu.generation)}
  <ContextMenu
    open={pageMenuOpen}
    ariaLabel="Page actions"
    x={menu.x}
    y={menu.y}
    actions={menu.actions}
    onclose={() => closePageMenu(menu.generation)}
  />
{/each}

<Dialog.Root bind:open={renameOpen}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header><Dialog.Title>Rename page</Dialog.Title></Dialog.Header>
    <Input
      aria-label="Page name"
      bind:value={renameDraft}
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          saveRename();
        }
      }}
    />
    <Dialog.Footer class="flex justify-end gap-2">
      <Button
        variant="ghost"
        size="sm"
        onclick={() => (renameOpen = false)}>Cancel</Button
      >
      <Button
        size="sm"
        disabled={!renameDraft.trim()}
        onclick={saveRename}>Save</Button
      >
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .page-tab-strip {
    scrollbar-width: none;
    -ms-overflow-style: none;
    --page-tab-left-mask: #000;
    --page-tab-right-mask: #000;
    mask-image: linear-gradient(
      to right,
      var(--page-tab-left-mask) 0,
      #000 16px,
      #000 calc(100% - 16px),
      var(--page-tab-right-mask) 100%
    );
    mask-repeat: no-repeat;
    -webkit-mask-image: linear-gradient(
      to right,
      var(--page-tab-left-mask) 0,
      #000 16px,
      #000 calc(100% - 16px),
      var(--page-tab-right-mask) 100%
    );
    -webkit-mask-repeat: no-repeat;
  }
  .page-tab-strip::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }
  .page-tab-strip.fade-left {
    --page-tab-left-mask: transparent;
  }
  .page-tab-strip.fade-right {
    --page-tab-right-mask: transparent;
  }
</style>

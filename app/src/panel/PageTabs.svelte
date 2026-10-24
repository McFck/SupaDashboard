<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Copy from '@lucide/svelte/icons/copy';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { Hint } from '$lib/components/ui/tooltip';
  import * as Tabs from '$lib/components/ui/tabs';
  import { SPRING_SAMPLES, springDuration } from '../core/controls';
  import type { Page } from '../core/settings.svelte';

  type PageDrag = {
    pageId: string;
    pointerId: number;
    from: number;
    destination: number;
    startX: number;
    latestX: number;
    startScroll: number;
    ids: string[];
    centers: number[];
    lefts: number[];
    widths: number[];
    buttons: HTMLButtonElement[];
    source: HTMLButtonElement;
    moved: boolean;
    raf: number | null;
  };

  let { pages, selectedPageId = $bindable(), onadd, onreorder, onrename, onduplicate, ondelete, active = true }: {
    pages: Page[]; selectedPageId: string; onadd: () => void; onreorder: (pageId: string, index: number) => void;
    onrename: (pageId: string, name: string) => boolean; onduplicate: (pageId: string) => void;
    ondelete: (pageId: string) => void; active?: boolean;
  } = $props();
  let list = $state<HTMLElement | null>(null);
  let drag = $state<PageDrag | null>(null);
  let skipClickUntil = 0;
  let renameOpen = $state(false);
  let renamePageId = $state('');
  let renameDraft = $state('');
  const selected = $derived(pages.find(page => page.id === selectedPageId));

  function orderMatches(current: PageDrag) {
    return pages.length === current.ids.length && pages.every((page, index) => page.id === current.ids[index]);
  }

  function resetStyles(current: PageDrag) {
    for (const button of current.buttons) {
      button.style.transition = 'none';
      button.style.removeProperty('transform');
    }
    requestAnimationFrame(() => {
      for (const button of current.buttons) button.style.removeProperty('transition');
    });
  }

  function cancelDrag() {
    const current = drag;
    if (!current) return;
    drag = null;
    if (current.raf !== null) cancelAnimationFrame(current.raf);
    resetStyles(current);
    if (current.source.hasPointerCapture(current.pointerId)) current.source.releasePointerCapture(current.pointerId);
  }

  function cancelPointer(event: PointerEvent) {
    if (drag?.pointerId === event.pointerId) cancelDrag();
  }

  function paintDrag(current: PageDrag) {
    if (!orderMatches(current) || !active) { cancelDrag(); return; }
    const scrollDelta = (list?.scrollLeft ?? current.startScroll) - current.startScroll;
    const dx = current.latestX - current.startX + scrollDelta;
    current.moved ||= Math.abs(dx) >= 6;
    if (!current.moved) return;
    const sourceCenter = current.centers[current.from] + dx;
    current.destination = current.from + current.centers.filter((center, index) => index > current.from && sourceCenter > center + scrollDelta).length -
      current.centers.filter((center, index) => index < current.from && sourceCenter < center + scrollDelta).length;
    current.destination = Math.max(0, Math.min(current.ids.length - 1, current.destination));
    const virtual = [...current.ids], [movedId] = virtual.splice(current.from, 1);
    virtual.splice(current.destination, 0, movedId);
    const leftById = new Map<string, number>();
    let cursor = current.lefts[0] - scrollDelta;
    const widthById = new Map(current.buttons.map((button, index) => [button.dataset.pageTab!, current.widths[index]]));
    for (const id of virtual) {
      leftById.set(id, cursor);
      cursor += (widthById.get(id) ?? 0) + 6;
    }
    for (let index = 0; index < current.ids.length; index++) {
      const button = current.buttons[index];
      const id = current.ids[index];
      button.style.transition = 'none';
      if (id === current.pageId) button.style.transform = `translateX(${dx}px)`;
      else button.style.transform = `translateX(${(leftById.get(id) ?? current.centers[index]) - (current.lefts[index] - scrollDelta)}px)`;
    }
  }

  function moveDrag(event: PointerEvent) {
    const current = drag;
    if (!current || current.pointerId !== event.pointerId) return;
    current.latestX = event.clientX;
    const scrollDelta = (list?.scrollLeft ?? current.startScroll) - current.startScroll;
    if (!current.moved && Math.abs(event.clientX - current.startX + scrollDelta) >= 6) {
      current.moved = true;
      current.source.setPointerCapture(current.pointerId);
    }
    if (current.raf !== null) return;
    current.raf = requestAnimationFrame(() => {
      current.raf = null;
      if (drag === current) paintDrag(current);
    });
  }

  function beginDrag(event: PointerEvent, page: Page, index: number) {
    if (event.button !== 0 || !active || !list) return;
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('[data-page-tab]')];
    const source = buttons.find(button => button.dataset.pageTab === page.id);
    if (!source || buttons.length !== pages.length) return;
    drag = { pageId: page.id, pointerId: event.pointerId, from: index, destination: index,
      startX: event.clientX, latestX: event.clientX, startScroll: list.scrollLeft,
      ids: pages.map(entry => entry.id), centers: buttons.map(button => {
        const rect = button.getBoundingClientRect(); return rect.left + rect.width / 2;
      }), lefts: buttons.map(button => button.getBoundingClientRect().left), widths: buttons.map(button => button.getBoundingClientRect().width),
      buttons, source, moved: false, raf: null };
  }

  async function finishDrag(event: PointerEvent) {
    const current = drag;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.raf !== null) cancelAnimationFrame(current.raf);
    current.raf = null;
    current.latestX = event.clientX;
    paintDrag(current);
    const shouldReorder = orderMatches(current) && current.moved && current.destination !== current.from;
    const target = current.destination;
    if (!shouldReorder) { cancelDrag(); return; }
    skipClickUntil = performance.now() + 400;
    const visualLeft = new Map(current.buttons.map(button => [button.dataset.pageTab!, button.getBoundingClientRect().left]));
    drag = null;
    if (current.source.hasPointerCapture(current.pointerId)) current.source.releasePointerCapture(current.pointerId);
    for (const button of current.buttons) { button.style.transition = 'none'; button.style.removeProperty('transform'); }
    onreorder(current.pageId, target);
    await tick();
    const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const buttons = [...(list?.querySelectorAll<HTMLButtonElement>('[data-page-tab]') ?? [])];
    for (const button of buttons) {
      const before = visualLeft.get(button.dataset.pageTab!);
      const offset = before === undefined ? 0 : before - button.getBoundingClientRect().left;
      if (prefersReduced || Math.abs(offset) < 0.5) { button.style.removeProperty('transform'); button.style.removeProperty('transition'); continue; }
      button.style.transform = `translateX(${offset}px)`;
      const animation = button.animate(SPRING_SAMPLES.map(({ progress }) => ({ transform: `translateX(${offset * (1 - progress)}px)` })),
        { duration: springDuration(Math.abs(offset)), fill: 'both' });
      void animation.finished.then(() => {
        button.style.removeProperty('transform');
        button.style.removeProperty('transition');
      }).catch(() => {});
    }
  }

  function openRename() {
    if (!selected) return;
    renamePageId = selected.id;
    renameDraft = selected.name;
    renameOpen = true;
  }

  function saveRename() {
    if (onrename(renamePageId, renameDraft)) renameOpen = false;
  }

  function keydown(event: KeyboardEvent, page: Page, index: number) {
    if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const next = index + (event.key === 'ArrowLeft' ? -1 : 1);
    if (next < 0 || next >= pages.length) return;
    event.preventDefault();
    onreorder(page.id, next);
  }

  function clickTab(event: MouseEvent) {
    if (performance.now() < skipClickUntil) { event.preventDefault(); event.stopPropagation(); }
  }

  function pointerUp(event: PointerEvent) { void finishDrag(event); }
  function keyWindow(event: KeyboardEvent) {
    if (event.key === 'Escape' && drag) { event.preventDefault(); cancelDrag(); }
  }

  $effect(() => {
    const current = drag;
    if (!current) return;
    if (!active || !orderMatches(current)) cancelDrag();
  });
  $effect(() => {
    if (selectedPageId !== renamePageId && renameOpen) renameOpen = false;
  });
  onDestroy(cancelDrag);
</script>

<svelte:window onpointermove={moveDrag} onpointerup={pointerUp} onpointercancel={cancelPointer} onkeydown={keyWindow} onblur={cancelDrag} />
<div class="flex min-w-0 items-center gap-1.5 border-b px-3 py-2">
  <Tabs.Root bind:value={selectedPageId} orientation="horizontal" class="min-w-0 flex-1">
    <Tabs.List bind:ref={list} aria-label="Pages" class="w-full justify-start overflow-x-auto rounded-none bg-transparent p-0 [scrollbar-width:thin]">
      {#each pages as page, index (page.id)}
        <Tabs.Trigger value={page.id} data-page-tab={page.id} onpointerdown={event => beginDrag(event, page, index)}
          onlostpointercapture={cancelPointer} onkeydown={event => keydown(event, page, index)} onclick={clickTab}
          class="h-9 min-w-20 flex-none select-none px-3 data-active:bg-muted/70">
          <span class="max-w-40 truncate">{page.name}</span>
        </Tabs.Trigger>
      {/each}
    </Tabs.List>
  </Tabs.Root>
  <Hint text="Add page" side="bottom">{#snippet children(props)}<Button {...props} data-page-action variant="ghost" size="icon-sm" aria-label="Add page" onclick={onadd}><Plus /></Button>{/snippet}</Hint>
  <Hint text="Rename page" side="bottom">{#snippet children(props)}<Button {...props} data-page-action variant="ghost" size="icon-sm" aria-label="Rename page" disabled={!selected} onclick={openRename}><Pencil /></Button>{/snippet}</Hint>
  <Hint text="Duplicate page" side="bottom">{#snippet children(props)}<Button {...props} data-page-action variant="ghost" size="icon-sm" aria-label="Duplicate page" disabled={!selected} onclick={() => selected && onduplicate(selected.id)}><Copy /></Button>{/snippet}</Hint>
  <Hint text="Delete page" side="bottom">{#snippet children(props)}<Button {...props} data-page-action variant="ghost" size="icon-sm" aria-label="Delete page" disabled={!selected || pages.length <= 1} onclick={() => selected && ondelete(selected.id)}><Trash2 /></Button>{/snippet}</Hint>
</div>

<Dialog.Root bind:open={renameOpen}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header><Dialog.Title>Rename page</Dialog.Title></Dialog.Header>
    <Input aria-label="Page name" bind:value={renameDraft} onkeydown={event => {
      if (event.key === 'Enter') { event.preventDefault(); saveRename(); }
    }} />
    <Dialog.Footer class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={() => renameOpen = false}>Cancel</Button>
      <Button size="sm" disabled={!renameDraft.trim()} onclick={saveRename}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

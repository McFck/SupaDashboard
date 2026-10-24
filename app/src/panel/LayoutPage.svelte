<script lang="ts">
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import { onDestroy, tick } from 'svelte';
  import Undo from '@lucide/svelte/icons/undo-2';
  import Redo from '@lucide/svelte/icons/redo-2';
  import X from '@lucide/svelte/icons/x';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Hint } from '$lib/components/ui/tooltip';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import { Slider } from '$lib/components/ui/slider';
  import DeckGrid from '../controls/DeckGrid.svelte';
  import { animateRemoval } from '../controls/removal';
  import { history, undo, redo, commit } from '../core/history.svelte';
  import { TRIGGERS, type Trigger } from '../core/scenario';
  import { dispatchRuntimeTrigger, runtimeView, simulateRuntimeEvent, stopRuntimeControl } from '../core/runtime.svelte';
  import { fits, type Selection } from '../core/layout';
  import { splitAlpha, withAlpha } from '../core/palette';
  import { registeredEvents } from '../core/registry';
  import { controlById, settings } from '../core/settings.svelte';
  import { addPage as buildPage, deletePage as buildDeletePage, duplicatePage as buildDuplicatePage, MAX_PAGES,
    movePlacement, pageAfterRemoval, pageById, pageItems, removePlacement, renamePage as buildRenamePage, reorderPage as buildReorderPage } from '../core/pages';
  import ColorField from '../editor/ColorField.svelte';
  import ScenarioEditor from '../editor/ScenarioEditor.svelte';
  import Inspector from './Inspector.svelte';
  import PageTabs from './PageTabs.svelte';
  import Choice from '../editor/Choice.svelte';
  import ContextMenu, { type MenuAction } from './ContextMenu.svelte';
  import Row from './ui/Row.svelte';
  import Section from './ui/Section.svelte';
  import { frame, saveFrame } from './ui/preferences.svelte';
  import { cloneControl, duplicateWidget, pasteWidget, type WidgetCopy } from './ui/layout-actions';
  import { clipboard } from './ui/widget-clipboard.svelte';

  let { active = true }: { active?: boolean } = $props();
  let selection = $state<Selection>(null);
  let scenarioOpen = $state(false);
  let scenarioRequest = $state<{ controlId: string; itemId: string; trigger?: Trigger } | null>(null);
  let rightPage = $state<'inspector' | 'canvas'>('inspector');
  let layout = $state<HTMLElement>();
  let layoutWidth = $state(0);
  let area = $state<HTMLElement>();
  let box = $state({ w: 0, h: 0 });
  let context = $state<{ pageId: string; target: NonNullable<Selection>; x: number; y: number; actions: MenuAction[]; generation: number } | null>(null);
  let menuOpen = $state(false);
  let menuGeneration = 0;
  let resizing = $state<{ x: number; width: number } | null>(null);
  let wasInactive = $state(false);
  const initialSelectedPageId = $runtimeView.activePage || settings.deck.activePage || settings.deck.pages[0].id;
  let selectedPageId = $state(initialSelectedPageId);
  let previousSelectedPageId = initialSelectedPageId;
  let previousPageOrder = settings.deck.pages.map(entry => entry.id);
  let pageGeneration = 0;
  let moveDialogOpen = $state(false);
  let moveRequest = $state<{ sourcePageId: string; itemId: string; destinationPageId: string } | null>(null);
  const bg = $derived(settings.display.background);
  const page = $derived(pageById(settings.deck.pages, selectedPageId)!);
  const allItems = $derived(pageItems(settings.deck.pages, settings.skinLayouts));
  const movePlan = $derived(moveRequest
    ? movePlacement(settings.deck.pages, moveRequest.sourcePageId, moveRequest.destinationPageId, moveRequest.itemId)
    : undefined);
  const moveOptions = $derived.by(() => {
    const request = moveRequest;
    return request ? settings.deck.pages.filter(candidate => candidate.id !== request.sourcePageId)
      .map(candidate => ({ value: candidate.id, label: candidate.name,
        disabled: !movePlacement(settings.deck.pages, request.sourcePageId, candidate.id, request.itemId) })) : [];
  });
  const rightWidth = $derived(Math.max(0, Math.min(frame.inspectorWidth, layoutWidth - 32)));
  $effect(() => { if (!active) wasInactive = true; });
  $effect(() => {
    if (!layout) return;
    const ro = new ResizeObserver(([e]) => {
      if (active && e.contentRect.width > 0) layoutWidth = e.contentRect.width;
    });
    ro.observe(layout);
    return () => ro.disconnect();
  });
  $effect(() => {
    if (!area) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (active && width > 0 && height > 0) box = { w: width, h: height };
    });
    ro.observe(area);
    return () => ro.disconnect();
  });
  $effect(() => {
    const ids = settings.deck.pages.map(entry => entry.id);
    const changed = ids.length !== previousPageOrder.length || ids.some((id, index) => id !== previousPageOrder[index]);
    if (!changed) return;
    const prior = previousPageOrder;
    previousPageOrder = ids;
    pageGeneration++;
    if (!ids.includes(selectedPageId)) selectedPageId = pageAfterRemoval(settings.deck.pages, selectedPageId, prior) ?? ids[0];
    if (context) closeMenu(context.generation);
    if (moveRequest && (!ids.includes(moveRequest.sourcePageId) || !ids.includes(moveRequest.destinationPageId))) closeMoveDialog();
  });
  $effect(() => {
    const current = selectedPageId;
    if (current === previousSelectedPageId) return;
    previousSelectedPageId = current;
    selection = null;
    if (context) closeMenu(context.generation);
    scenarioOpen = false;
    closeMoveDialog();
  });
  $effect(() => {
    if (!active || !layout || !area) return;
    const frameId = requestAnimationFrame(() => {
      if (!active || !layout || !area) return;
      const width = layout.getBoundingClientRect().width;
      const rect = area.getBoundingClientRect();
      if (width > 0) layoutWidth = width;
      if (rect.width > 0 && rect.height > 0) box = { w: rect.width, h: rect.height };
    });
    return () => cancelAnimationFrame(frameId);
  });
  $effect(() => {
    if (selection && 'item' in selection && !page.items.some(i => i.id === (selection as { item: string }).item)) selection = null;
  });
  $effect(() => {
    const payload = context;
    if (!menuOpen || !payload) return;
    const current = selection;
    const sameSelection = current && ('item' in payload.target
      ? 'item' in current && current.item === payload.target.item
      : 'cell' in current && current.cell.x === payload.target.cell.x && current.cell.y === payload.target.cell.y);
    const target = payload.target;
    const targetPage = settings.deck.pages.find(candidate => candidate.id === payload.pageId);
    const targetExists = !!targetPage && ('item' in target
      ? targetPage.items.some(item => item.id === target.item)
      : target.cell.x >= 0 && target.cell.y >= 0 && target.cell.x < targetPage.cols && target.cell.y < targetPage.rows);
    if (!sameSelection || payload.pageId !== page.id || !targetExists) closeMenu(payload.generation);
  });
  $effect(() => {
    if (active) return;
    if (context) closeMenu(context.generation);
    scenarioOpen = false;
    closeMoveDialog();
    if (resizing) { resizing = null; saveFrame(); }
  });
  onDestroy(() => { if (context) closeMenu(context.generation); closeMoveDialog(); });
  function select(s: Selection) {
    selection = s;
    rightPage = 'inspector';
    if (s) { frame.inspectorOpen = true; saveFrame(); }
  }
  function openDeck() { select(null); frame.inspectorOpen = true; saveFrame(); }
  function openScenario(controlId: string, itemId: string, trigger: Trigger = 'press') {
    scenarioRequest = { controlId, itemId, trigger };
    scenarioOpen = true;
  }
  function closeInspector() { frame.inspectorOpen = false; saveFrame(); }
  function closeMenu(generation: number) {
    if (context?.generation === generation) menuOpen = false;
  }
  function closeMoveDialog() { moveDialogOpen = false; moveRequest = null; }
  function addPage() {
    if (settings.deck.pages.length >= MAX_PAGES) return;
    const result = buildPage(settings.deck.pages, settings.controls, page.id, settings.skinLayouts);
    if (!result) return;
    commit('Add page');
    settings.deck.pages = result.pages;
    selectedPageId = result.page.id;
    selection = null;
  }
  function renamePage(pageId: string, name: string) {
    const result = buildRenamePage(settings.deck.pages, pageId, name);
    if (!result) return false;
    commit('Rename page');
    settings.deck.pages = result.pages;
    return true;
  }
  function duplicatePage(pageId: string) {
    if (settings.deck.pages.length >= MAX_PAGES) return;
    const result = buildDuplicatePage(settings.deck.pages, pageId, settings.controls, settings.variants, settings.skinLayouts);
    if (!result) { toast.error('Unable to duplicate page'); return; }
    commit('Duplicate page');
    settings.deck.pages = result.pages;
    settings.controls = result.controls;
    settings.variants = result.variants;
    settings.skinLayouts = result.skinLayouts;
    selectedPageId = result.page.id;
    selection = null;
  }
  function reorderPages(pageId: string, index: number) {
    const result = buildReorderPage(settings.deck.pages, pageId, index);
    if (!result) return;
    commit('Reorder pages');
    settings.deck.pages = result.pages;
  }
  async function deletePage(pageId: string) {
    const order = settings.deck.pages.map(entry => entry.id);
    const generation = pageGeneration;
    if (!await confirm({ title: 'Delete page?', action: 'Delete', destructive: true })) return;
    if (pageGeneration !== generation || settings.deck.pages.length <= 1 || !settings.deck.pages.some(entry => entry.id === pageId)) return;
    const result = buildDeletePage(settings.deck.pages, pageId, settings.controls, settings.variants, settings.skinLayouts);
    if (!result) return;
    const nextSelected = pageAfterRemoval(result.pages, pageId, order) ?? result.pages[0].id;
    commit('Delete page');
    settings.deck.pages = result.pages;
    settings.controls = result.controls;
    settings.variants = result.variants;
    settings.skinLayouts = result.skinLayouts;
    selectedPageId = nextSelected;
    selection = null;
  }
  function openMoveDialog(pageId: string, itemId: string) {
    const candidates = settings.deck.pages.filter(candidate => candidate.id !== pageId);
    const firstAvailable = candidates.find(candidate => movePlacement(settings.deck.pages, pageId, candidate.id, itemId));
    moveRequest = { sourcePageId: pageId, itemId, destinationPageId: firstAvailable?.id ?? candidates[0]?.id ?? '' };
    moveDialogOpen = true;
  }
  async function finishMove() {
    const request = moveRequest;
    if (!request || selectedPageId !== request.sourcePageId) return;
    const result = movePlacement(settings.deck.pages, request.sourcePageId, request.destinationPageId, request.itemId);
    if (!result) { toast.error('No free space for this widget'); return; }
    const destination = settings.deck.pages.find(candidate => candidate.id === request.destinationPageId);
    commit(destination ? `Move widget to ${destination.name}` : 'Move widget');
    settings.deck.pages = result.pages;
    selectedPageId = request.destinationPageId;
    closeMoveDialog();
    await tick();
    select({ item: result.item.id });
  }
  function openMenu(target: NonNullable<Selection>, x: number, y: number) {
    const snapshot: NonNullable<Selection> = 'item' in target ? { item: target.item } : { cell: { ...target.cell } };
    context = { pageId: page.id, target: snapshot, x, y, actions: actionsFor(snapshot, page.id).map(action => ({ ...action })), generation: ++menuGeneration };
    menuOpen = true;
  }
  function moveResize(e: PointerEvent) {
    if (active && resizing) frame.inspectorWidth = Math.round(Math.max(320, Math.min(640, resizing.width + resizing.x - e.clientX)));
  }
  function stopResize() { if (active && resizing) { resizing = null; saveFrame(); } }
  function remove(id: string, pageId: string) {
    const result = removePlacement(settings.deck.pages, pageId, id, settings.skinLayouts);
    if (!result.item) return;
    settings.deck.pages = result.pages;
    settings.skinLayouts = result.skinLayouts;
    if (result.orphanControl) {
      settings.controls = settings.controls.filter(c => c.id !== result.orphanControl);
      delete settings.variants[result.orphanControl];
    }
    if (selection && 'item' in selection && selection.item === id) selection = null;
  }
  async function removeItemFromPage(id: string, pageId: string) {
    const source = settings.deck.pages.find(candidate => candidate.id === pageId);
    const item = source?.items.find(candidate => candidate.id === id);
    if (!item) return;
    const name = controlById(item.control)?.name ?? 'widget';
    await animateRemoval(id);
    if (!settings.deck.pages.find(candidate => candidate.id === pageId)?.items.some(entry => entry.id === id)) return;
    commit(`Delete ${name}`);
    remove(id, pageId);
  }
  function deleteKeydown(event: KeyboardEvent) {
    if (!active || event.key !== 'Delete' || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
      menuOpen || moveDialogOpen || scenarioOpen) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="dialog"], [role="alertdialog"]'))) return;
    const itemId = selection && 'item' in selection ? selection.item : undefined;
    if (itemId) {
      event.preventDefault();
      void removeItemFromPage(itemId, page.id);
      return;
    }
    const focusedTab = document.activeElement instanceof HTMLElement && document.activeElement.matches('[data-page-tab][aria-selected="true"]');
    if (focusedTab && settings.deck.pages.length > 1) {
      event.preventDefault();
      void deletePage(selectedPageId);
    }
  }
  function insert(copy: WidgetCopy, target: NonNullable<Selection>, pageId: string, replace = false) {
    const targetPage = settings.deck.pages.find(candidate => candidate.id === pageId);
    if (!targetPage || page.id !== pageId) return;
    const old = 'item' in target ? targetPage.items.find(i => i.id === target.item) : undefined;
    const at = 'cell' in target ? target.cell : old;
    if (!at) { toast.error('No free space for this widget'); return; }
    const result = pasteWidget(copy, targetPage.items, allItems, settings.controls, targetPage, at, replace ? old?.id : undefined);
    if (!result) { toast.error('No free space for this widget'); return; }
    commit(replace ? 'Paste over widget' : 'Paste widget');
    if (replace && old) remove(old.id, pageId);
    settings.controls.push(result.control);
    settings.deck.pages.find(candidate => candidate.id === pageId)?.items.push(result.item);
    select({ item: result.item.id });
  }
  async function pasteSnapshot(copy: WidgetCopy, target: NonNullable<Selection>, pageId: string) {
    const targetPage = settings.deck.pages.find(candidate => candidate.id === pageId);
    if (!targetPage || page.id !== pageId) return;
    if ('item' in target) {
      const id = target.item;
      const current = targetPage.items.find(i => i.id === id);
      if (!current) return;
      if (!fits(targetPage.items, { x: current.x, y: current.y, w: copy.w, h: copy.h }, targetPage, [id])) {
        toast.error('No free space for this widget');
        return;
      }
      if (!await confirm({ title: 'Replace widget?', action: 'Replace', destructive: true })) return;
      if (page.id !== pageId || !settings.deck.pages.find(candidate => candidate.id === pageId)?.items.some(item => item.id === id)) return;
      insert(copy, { item: id }, pageId, true);
      return;
    }
    if (!fits(targetPage.items, { ...target.cell, w: copy.w, h: copy.h }, targetPage)) {
      toast.error('No free space for this widget');
      return;
    }
    insert(copy, target, pageId);
  }
  async function simulate(controlId: string, itemId: string, trigger: Trigger) {
    const result = await dispatchRuntimeTrigger(controlId, itemId, trigger);
    if (result.status === 'rejected') toast.error('Runtime owner is unavailable');
  }
  async function simulateEvent(eventId: string, parameter?: string) {
    if (!await simulateRuntimeEvent(eventId, parameter)) toast.error('Runtime owner is unavailable');
  }
  function actionsFor(target: NonNullable<Selection>, pageId: string): MenuAction[] {
    const sourcePage = settings.deck.pages.find(candidate => candidate.id === pageId);
    if (!sourcePage) return [];
    const item = 'item' in target ? sourcePage.items.find(i => i.id === target.item) : undefined;
    const control = item ? controlById(item.control) : undefined;
    const copy = clipboard.value;
    const pasteAt = 'cell' in target ? target.cell : item;
    const paste: MenuAction = { label: 'Paste', disabled: !copy || !pasteAt, run: () => {
      const latest = clipboard.value;
      if (!latest) return;
      const snapshot = structuredClone($state.snapshot(latest));
      const targetSnapshot: NonNullable<Selection> = 'item' in target ? { item: target.item } : { cell: { ...target.cell } };
      void pasteSnapshot(snapshot, targetSnapshot, pageId);
    } };
    if (!item || !control) {
      if (!('cell' in target)) return [];
      return [{ label: 'Edit', run: () => select(target) }, paste];
    }
    const configured = TRIGGERS.filter(trigger => control.scenario?.triggers[trigger] !== undefined);
    const labels: Record<Trigger, string> = { press: 'Press', release: 'Release', longPress: 'Long press', longPressRelease: 'Long press release',
      doubleTap: 'Double tap', swipeUp: 'Pull up', swipeDown: 'Pull down', swipeLeft: 'Pull left', swipeRight: 'Pull right' };
    const eventTitles = new Map(registeredEvents().map(event => [event.id, event.title]));
    const running = ($runtimeView.busy[control.id] ?? 0) > 0;
    return [
      { label: 'Edit', run: () => select(target) },
      { label: 'Edit scenario', run: () => openScenario(control.id, item.id, 'press') },
      ...configured.map(trigger => ({ label: 'Simulate ' + labels[trigger], run: () => { void simulate(control.id, item.id, trigger); } })),
      ...control.scenario?.events.map(event => ({ label: `Simulate event · ${eventTitles.get(event.eventId) ?? event.eventId}`,
        run: () => { void simulateEvent(event.eventId, event.parameter); } })) ?? [],
      ...(running ? [{ label: 'Stop', run: () => { void stopRuntimeControl(control.id); } }] : []),
      { label: 'Copy', run: () => {
        clipboard.value = { control: cloneControl(control), w: item.w, h: item.h };
        void navigator.clipboard?.writeText(JSON.stringify(clipboard.value)).catch(() => {});
      } }, paste,
      { label: 'Move to page…', disabled: settings.deck.pages.length <= 1, run: () => openMoveDialog(pageId, item.id) },
      { label: 'Duplicate', run: () => {
        const result = duplicateWidget({ control, w: item.w, h: item.h }, sourcePage.items, allItems, settings.controls, sourcePage);
        if (!result) { toast.error('No free space for this widget'); return; }
        commit(`Duplicate ${control.name}`); result.control.name += ' copy'; settings.controls.push(result.control); sourcePage.items.push(result.item); select({ item: result.item.id });
      } },
      { label: 'Delete', danger: true, run: async () => {
        await removeItemFromPage(item.id, pageId);
      } },
    ];
  }
</script>

<svelte:window onkeydown={deleteKeydown} onpointermove={moveResize} onpointerup={stopResize} onpointercancel={stopResize} onblur={stopResize} />
<div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
  <header class="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-5">
    <h1 class="text-xl font-semibold tracking-tight">Layout</h1>
    <div class="flex items-center gap-2">
      <Hint text="Undo" keys={['Ctrl', 'Z']} side="bottom">{#snippet children(props)}<Button {...props} variant="ghost" size="icon-sm" aria-label="Undo" disabled={!history.canUndo} onclick={undo}><Undo /></Button>{/snippet}</Hint>
      <Hint text="Redo" keys={['Ctrl', 'Shift', 'Z']} side="bottom">{#snippet children(props)}<Button {...props} variant="ghost" size="icon-sm" aria-label="Redo" disabled={!history.canRedo} onclick={redo}><Redo /></Button>{/snippet}</Hint>
      <Button variant="outline" size="sm" aria-pressed={frame.inspectorOpen && rightPage === 'canvas'}
        onclick={() => { rightPage = 'canvas'; frame.inspectorOpen = true; saveFrame(); }}>Canvas</Button>
      <Button variant="ghost" size="icon-sm" aria-label={frame.inspectorOpen && rightPage === 'inspector' ? 'Close inspector' : 'Open inspector'} aria-pressed={frame.inspectorOpen && rightPage === 'inspector'}
        onclick={() => { frame.inspectorOpen = !(frame.inspectorOpen && rightPage === 'inspector'); rightPage = 'inspector'; saveFrame(); }}><PanelRight /></Button>
    </div>
  </header>
  <div bind:this={layout} class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--canvas-surface)]">
      <PageTabs pages={settings.deck.pages} bind:selectedPageId active={active} onadd={addPage} onreorder={reorderPages}
        onrename={renamePage} onduplicate={duplicatePage} ondelete={deletePage} />
      <div bind:this={area} role="presentation" onclick={e => { if (e.target === e.currentTarget || e.target === e.currentTarget.lastElementChild) openDeck(); }}
        class="relative grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden">
        <div aria-hidden="true" class="canvas-grid"></div>
        <div class="grid min-h-0 min-w-0 place-items-center" class:canvas-enter={active && wasInactive}>
          {#key page.id}
            <DeckGrid {page} editing selected={selection} onselect={select} oncontext={openMenu}
              availableWidth={Math.max(0, box.w - 48)} availableHeight={Math.max(0, box.h - 48)} />
          {/key}
        </div>
      </div>
    </div>
    <div class="right-slot relative min-h-0 shrink-0 overflow-hidden" class:resizing={resizing !== null} class:inactive={!active} style:width="{frame.inspectorOpen ? rightWidth : 0}px">
      <section aria-label={rightPage === 'canvas' ? 'Canvas' : 'Inspector'} aria-hidden={!frame.inspectorOpen} inert={!frame.inspectorOpen}
        style:width="{rightWidth}px" class="right-panel absolute inset-y-0 left-0 flex min-h-0 flex-col overflow-hidden border-l bg-sidebar" class:open={frame.inspectorOpen}>
        <button type="button" aria-label="Resize inspector"
          onpointerdown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); resizing = { x: e.clientX, width: frame.inspectorWidth }; }}
          onkeydown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); frame.inspectorWidth = Math.max(320, Math.min(640, frame.inspectorWidth + (e.key === 'ArrowLeft' ? 16 : -16))); saveFrame(); } }}
          class="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none bg-transparent outline-none hover:bg-primary/40 focus-visible:bg-primary/40"></button>
        <Button variant="ghost" size="icon" class="absolute top-4 right-3 z-10" aria-label="Close inspector" onclick={closeInspector}><X /></Button>
        {#if rightPage === 'canvas'}
          <header class="flex h-16 shrink-0 items-center border-b px-4 pr-14"><p class="font-semibold">Canvas</p></header>
          <div class="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]">
            <Section>
              <Row label="Colour" wide><ColorField palette={['#0a0a0a', '#171717', '#0f172a', '#1e1b4b', '#052e16', '#3f0d12']} value={withAlpha(bg.color, bg.opacity)}
                onchange={v => { const p = splitAlpha(v); commit('Canvas colour'); settings.display.background = { ...bg, color: p.hex, opacity: p.alpha }; }} /></Row>
              <Row label="Corner radius"><div class="flex w-44 items-center gap-3">
                <Slider type="single" class="min-w-0 flex-1" value={bg.radius} min={0} max={60} step={1} onValueChange={v => { commit('Canvas radius'); settings.display.background = { ...bg, radius: v }; }} />
                <span class="w-10 text-right text-sm tabular-nums text-muted-foreground">{bg.radius}px</span>
              </div></Row>
            </Section>
          </div>
        {:else}
          <div class="inspector-content min-h-0 flex-1 overflow-hidden">
            {#key `${page.id}:${selection && 'item' in selection ? selection.item : 'collection'}`}
              <Inspector {page} {selection} onselect={select} oneditScenario={openScenario} />
            {/key}
          </div>
        {/if}
      </section>
    </div>
  </div>
</div>
{#if scenarioOpen && scenarioRequest}
  <ScenarioEditor bind:open={scenarioOpen} controlId={scenarioRequest.controlId} itemId={scenarioRequest.itemId}
    initialTrigger={scenarioRequest.trigger} />
{/if}
<Dialog.Root open={moveDialogOpen} onOpenChange={open => { if (!open) closeMoveDialog(); }}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header><Dialog.Title>Move to page</Dialog.Title></Dialog.Header>
    <Choice value={moveRequest?.destinationPageId ?? ''} options={moveOptions}
      aria-label="Destination page" onchange={value => { if (moveRequest) moveRequest.destinationPageId = value; }} />
    <Dialog.Footer class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={closeMoveDialog}>Cancel</Button>
      <Button size="sm" disabled={!moveRequest || !movePlan} onclick={() => void finishMove()}>Move</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
{#each (menuOpen && context ? [context] : []) as payload (payload.generation)}
  <ContextMenu open={menuOpen} x={payload.x} y={payload.y} actions={payload.actions} onclose={() => closeMenu(payload.generation)} />
{/each}

<style>
  .canvas-grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: radial-gradient(circle, rgb(255 255 255 / .07) 1px, transparent 1px);
    background-size: 20px 20px;
    opacity: .65;
  }
  .canvas-enter { animation: canvas-enter 100ms ease-out; }
  @keyframes canvas-enter { from { opacity: 0; } to { opacity: 1; } }
  /* shadcn Sidebar style: the slot animates its width and the panel rides its left edge, so it slides in and out. */
  .right-slot { transition: width 240ms cubic-bezier(.32, .72, 0, 1); }
  .right-slot.inactive { transition: none; }
  .right-slot.resizing { transition: none; }
  .inspector-content :global(aside) { min-height: 0; overflow: hidden; }
  .inspector-content :global(aside > header) { flex-shrink: 0; padding-right: 3.5rem; }
  @media (prefers-reduced-motion: reduce) { .canvas-enter { animation-duration: 0ms; } .right-slot { transition: none; } }
</style>

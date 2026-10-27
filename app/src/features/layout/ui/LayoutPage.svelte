<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import SkinLayoutEditor from './SkinLayoutEditor.svelte';
  import { animateRemoval } from '../removal';
  import { commit } from '../history.svelte';
  import { TRIGGER_LABELS, TRIGGERS, type Trigger } from '../../automation/scenario';
  import { runtimeView } from '../../../app/runtime/state';
  import { firstFree, type Selection } from '../grid';
  import { registeredEvents, skins } from '../../plugins/registry';
  import { controlById, settings } from '../../settings/state.svelte';
  import { MAX_PAGES, pageAfterRemoval, pageById, pageItems, removePlacement } from '../pages';
  import * as pageCommands from '../page-commands';
  import ScenarioEditor from '../../automation/editor/ScenarioEditor.svelte';
  import Inspector from './Inspector.svelte';
  import PageTabs from './PageTabs.svelte';
  import HistoryControls from './HistoryControls.svelte';
  import InspectorPane from './InspectorPane.svelte';
  import MoveWidgetDialog from './MoveWidgetDialog.svelte';
  import { layoutFor, movePlacementToSlot, type LayoutTarget } from '../skin-layouts';
  import type { SkinDef } from '../../skins/definition';
  import ContextMenu, { type MenuAction } from '../../../panel/ui/ContextMenu.svelte';
  import {
    frame,
    layoutPreview,
    saveFrame,
    saveLayoutPreview,
  } from '../../../panel/ui/preferences.svelte';
  import { cloneControl, type WidgetCopy } from '../layout-actions';
  import { clipboard } from '../widget-clipboard.svelte';
  import { insertWidget, planInsertion } from '../widget-insert';
  import { moveOptions as buildMoveOptions, type MoveMode } from '../move-options';
  import { getRuntimeCommands } from '../../../app/runtime/context';

  type Target = NonNullable<Selection>;
  type MenuState = {
    pageId: string;
    layoutTarget: LayoutTarget;
    target: Target;
    x: number;
    y: number;
    actions: MenuAction[];
    generation: number;
  };
  type MoveRequest = {
    mode: MoveMode;
    sourceTarget: LayoutTarget;
    itemId: string;
    destinationKey: string;
  };

  /** Keeps the canvas visible beside the inspector. */
  const CANVAS_MIN_WIDTH = 32;
  const NO_ROOM = 'No free space for this widget';

  const { dispatchRuntimeTrigger, simulateRuntimeEvent, stopRuntimeControl } = getRuntimeCommands();

  let { active = true }: { active?: boolean } = $props();

  let selection = $state<Selection>(null);
  let scenarioOpen = $state(false);
  let scenarioRequest = $state<{ controlId: string; itemId: string; trigger?: Trigger } | null>(
    null,
  );
  let layout = $state<HTMLElement>();
  let layoutWidth = $state(0);
  let context = $state<MenuState | null>(null);
  let menuOpen = $state(false);
  let menuGeneration = 0;
  let wasInactive = $state(false);
  let moveDialogOpen = $state(false);
  let moveRequest = $state<MoveRequest | null>(null);

  const initialPageId =
    $runtimeView.activePage || settings.deck.activePage || settings.deck.pages[0].id;
  const initialSkinId = skins.has(settings.skin) ? settings.skin : 'deck';
  const initialSkin = skins.get(initialSkinId) ?? skins.get('deck')!;
  const initialViewId = initialSkin.views.some(
    (view) => view.id === layoutPreview.views[initialSkinId],
  )
    ? layoutPreview.views[initialSkinId]
    : initialSkin.defaultView;

  let selectedPageId = $state(initialPageId);
  let selectedSkinId = $state(initialSkinId);
  let previewViewId = $state(initialViewId);
  let selectionTarget = $state<LayoutTarget>(
    defaultTarget(initialSkin, initialPageId, initialViewId),
  );
  let previousSkinId = initialSkinId;
  let previousViewId = initialViewId;
  let previousActiveSkinId = settings.skin;
  let previousSelectedPageId = initialPageId;
  let previousPageOrder = settings.deck.pages.map((entry) => entry.id);
  /** Bumped whenever pages are added, removed or reordered, so awaited actions can detect a stale page. */
  let pageGeneration = 0;

  const page = $derived(pageById(settings.deck.pages, selectedPageId)!);
  const editorSkin = $derived(skins.get(selectedSkinId) ?? skins.get('deck')!);
  const visibleSlots = $derived(
    editorSkin.views.find((view) => view.id === previewViewId)?.slots ?? [],
  );
  const editorTarget = $derived.by(() => {
    const valid =
      selectionTarget.skinId === editorSkin.id &&
      selectionTarget.pageId === page.id &&
      editorSkin.slots.some((slot) => slot.id === selectionTarget.slotId) &&
      visibleSlots.includes(selectionTarget.slotId);
    if (valid) {
      return selectionTarget;
    }
    return {
      skinId: editorSkin.id,
      pageId: page.id,
      slotId: visibleSlots[0] ?? editorSkin.slots[0]?.id ?? 'main',
    };
  });
  const allItems = $derived(pageItems(settings.deck.pages, settings.skinLayouts));
  const moveOptions = $derived(
    moveRequest ? optionsFor(moveRequest.mode, moveRequest.sourceTarget, moveRequest.itemId) : [],
  );
  const moveDestination = $derived(
    moveOptions.find((option) => option.value === moveRequest?.destinationKey && !option.disabled)
      ?.target,
  );
  const inspectorWidth = $derived(
    Math.max(0, Math.min(frame.inspectorWidth, layoutWidth - CANVAS_MIN_WIDTH)),
  );

  // The inspector always has content, so it never closes; "close" falls back to the Deck settings.
  frame.inspectorOpen = true;

  $effect(() => {
    if (!active) {
      wasInactive = true;
    }
  });

  $effect(() => {
    if (!layout) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (active && entry.contentRect.width > 0) {
        layoutWidth = entry.contentRect.width;
      }
    });
    observer.observe(layout);
    return () => observer.disconnect();
  });

  // Returning to the page re-measures once, since the observer skips updates while inactive.
  $effect(() => {
    if (!active || !layout) {
      return;
    }
    const frameId = requestAnimationFrame(() => {
      const width = active ? layout?.getBoundingClientRect().width : 0;
      if (width) {
        layoutWidth = width;
      }
    });
    return () => cancelAnimationFrame(frameId);
  });

  // Pages were added, removed or reordered.
  $effect(() => {
    const ids = settings.deck.pages.map((entry) => entry.id);
    const changed =
      ids.length !== previousPageOrder.length ||
      ids.some((id, index) => id !== previousPageOrder[index]);
    if (!changed) {
      return;
    }
    const prior = previousPageOrder;
    previousPageOrder = ids;
    pageGeneration++;
    if (!ids.includes(selectedPageId)) {
      selectedPageId = pageAfterRemoval(settings.deck.pages, selectedPageId, prior) ?? ids[0];
    }
    closeCurrentMenu();
    const request = moveRequest;
    const requestStale =
      request &&
      (!ids.includes(request.sourceTarget.pageId) ||
        !moveOptions.some((option) => option.value === request.destinationKey));
    if (requestStale) {
      closeMoveDialog();
    }
  });

  // Another page was selected.
  $effect(() => {
    const current = selectedPageId;
    if (current === previousSelectedPageId) {
      return;
    }
    previousSelectedPageId = current;
    selection = null;
    selectionTarget = defaultTarget(editorSkin, page.id, previewViewId);
    closeCurrentMenu();
    scenarioOpen = false;
    closeMoveDialog();
  });

  // The dashboard switched skins: preview the new one.
  $effect(() => {
    const skinId = settings.skin;
    if (skinId === previousActiveSkinId) {
      return;
    }
    previousActiveSkinId = skinId;
    const skin = skins.get(skinId);
    if (!skin) {
      return;
    }
    selectedSkinId = skin.id;
    const storedView = layoutPreview.views[skin.id];
    previewViewId = skin.views.some((view) => view.id === storedView)
      ? storedView
      : skin.defaultView;
    selectionTarget = defaultTarget(skin, page.id, previewViewId);
    clearEditorTransient();
  });

  // The previewed skin or view changed: remember the view and keep the selection inside it.
  $effect(() => {
    const skinId = selectedSkinId;
    const viewId = previewViewId;
    if (skinId === previousSkinId && viewId === previousViewId) {
      return;
    }
    previousSkinId = skinId;
    previousViewId = viewId;
    const skin = skins.get(skinId);
    const view = skin?.views.find((entry) => entry.id === viewId);
    if (!skin || !view) {
      return;
    }
    layoutPreview.views[skinId] = viewId;
    if (!view.slots.includes(selectionTarget.slotId) || selectionTarget.skinId !== skinId) {
      selectionTarget = defaultTarget(skin, page.id, viewId);
    }
    clearEditorTransient();
    saveLayoutPreview();
  });

  // Drop a selection whose placement left the edited slot.
  $effect(() => {
    const selectedId = selection && 'item' in selection ? selection.item : undefined;
    if (!selectedId) {
      return;
    }
    const slot = layoutFor(settings, editorTarget.skinId, editorTarget.pageId, editorTarget.slotId);
    if (!slot?.items.some((item) => item.id === selectedId)) {
      selection = null;
    }
  });

  // Close the context menu once its target is no longer what it was opened for.
  $effect(() => {
    const payload = context;
    if (!menuOpen || !payload) {
      return;
    }
    const stillTargeted =
      sameTarget(selection, payload.target) &&
      payload.pageId === page.id &&
      payload.layoutTarget.skinId === editorSkin.id &&
      targetExists(payload);
    if (!stillTargeted) {
      closeMenu(payload.generation);
    }
  });

  $effect(() => {
    if (active) {
      return;
    }
    closeCurrentMenu();
    scenarioOpen = false;
    closeMoveDialog();
  });

  onDestroy(() => {
    closeCurrentMenu();
    closeMoveDialog();
  });

  function defaultTarget(skin: SkinDef, pageId: string, viewId: string): LayoutTarget {
    const view =
      skin.views.find((entry) => entry.id === viewId) ??
      skin.views.find((entry) => entry.id === skin.defaultView);
    return { skinId: skin.id, pageId, slotId: view?.slots[0] ?? skin.slots[0]?.id ?? 'main' };
  }

  function sameTarget(current: Selection, target: Target) {
    if (!current) {
      return false;
    }
    if ('item' in target) {
      return 'item' in current && current.item === target.item;
    }
    return (
      'cell' in current && current.cell.x === target.cell.x && current.cell.y === target.cell.y
    );
  }

  function targetExists(payload: MenuState) {
    const { skinId, pageId, slotId } = payload.layoutTarget;
    const slot = layoutFor(settings, skinId, pageId, slotId);
    if (!settings.deck.pages.some((candidate) => candidate.id === payload.pageId) || !slot) {
      return false;
    }
    const target = payload.target;
    if ('item' in target) {
      return slot.items.some((item) => item.id === target.item);
    }
    const geometry = slot.geometry;
    return (
      !!geometry &&
      target.cell.x >= 0 &&
      target.cell.y >= 0 &&
      target.cell.x < geometry.cols &&
      target.cell.y < geometry.rows
    );
  }

  function clearEditorTransient() {
    selection = null;
    closeCurrentMenu();
    scenarioOpen = false;
    closeMoveDialog();
  }

  function select(next: Selection, target?: LayoutTarget) {
    selection = next;
    if (target) {
      selectionTarget = target;
    }
    if (next) {
      frame.inspectorOpen = true;
      saveFrame();
    }
  }

  function openDeckSettings() {
    select(null);
    frame.inspectorOpen = true;
    saveFrame();
  }

  function openScenario(controlId: string, itemId: string, trigger: Trigger = 'press') {
    scenarioRequest = { controlId, itemId, trigger };
    scenarioOpen = true;
  }

  function closeMenu(generation: number) {
    if (context?.generation === generation) {
      menuOpen = false;
    }
  }

  function closeCurrentMenu() {
    if (context) {
      closeMenu(context.generation);
    }
  }

  function closeMoveDialog() {
    moveDialogOpen = false;
    moveRequest = null;
  }

  // ---- pages ----

  function showPage(pageId: string | undefined) {
    if (pageId) {
      selectedPageId = pageId;
      selection = null;
    }
  }

  function duplicatePage(pageId: string) {
    if (settings.deck.pages.length >= MAX_PAGES) {
      return;
    }
    const copyId = pageCommands.duplicatePage(pageId);
    if (!copyId) {
      toast.error('Unable to duplicate page');
      return;
    }
    showPage(copyId);
  }

  async function deletePage(pageId: string) {
    const generation = pageGeneration;
    if (!(await confirm({ title: 'Delete page?', action: 'Delete', destructive: true }))) {
      return;
    }
    if (pageGeneration === generation) {
      showPage(pageCommands.deletePage(pageId));
    }
  }

  // ---- moving a widget to another page or slot ----

  function optionsFor(mode: MoveMode, sourceTarget: LayoutTarget, itemId: string) {
    const skin = skins.get(sourceTarget.skinId);
    const slots = skin?.views.find((view) => view.id === previewViewId)?.slots ?? [];
    return buildMoveOptions(settings, skin, slots, mode, sourceTarget, itemId);
  }

  function openMoveDialog(mode: MoveMode, sourceTarget: LayoutTarget, itemId: string) {
    const { skinId, pageId, slotId } = sourceTarget;
    const source = layoutFor(settings, skinId, pageId, slotId);
    const firstAvailable = optionsFor(mode, sourceTarget, itemId).find(
      (option) => !option.disabled,
    );
    if (!source?.items.some((item) => item.id === itemId) || !firstAvailable) {
      toast.error(NO_ROOM);
      return;
    }
    moveRequest = {
      mode,
      sourceTarget: { ...sourceTarget },
      itemId,
      destinationKey: firstAvailable.value,
    };
    moveDialogOpen = true;
  }

  async function finishMove() {
    const request = moveRequest;
    const destination = moveDestination;
    if (!request || !destination || !moveSourceStillShown(request)) {
      closeMoveDialog();
      return;
    }
    const result = movePlacementToSlot(settings, request.itemId, destination);
    if (!result) {
      toast.error(NO_ROOM);
      return;
    }
    const destinationPage = settings.deck.pages.find(
      (candidate) => candidate.id === destination.pageId,
    );
    commit(destinationPage ? `Move widget to ${destinationPage.name}` : 'Move widget');
    settings.deck.pages = result.pages;
    settings.skinLayouts = result.skinLayouts;
    selectedPageId = destination.pageId;
    selectionTarget = destination;
    closeMoveDialog();
    await tick();
    select({ item: result.item.id }, destination);
  }

  function moveSourceStillShown(request: MoveRequest) {
    const { skinId, pageId, slotId } = request.sourceTarget;
    const source = layoutFor(settings, skinId, pageId, slotId);
    return (
      selectedPageId === pageId &&
      editorSkin.id === skinId &&
      !!source?.items.some((item) => item.id === request.itemId) &&
      visibleSlots.includes(slotId)
    );
  }

  // ---- removing ----

  function remove(id: string, pageId: string, target: LayoutTarget) {
    const source = layoutFor(settings, target.skinId, target.pageId, target.slotId);
    if (target.pageId !== pageId || !source?.items.some((item) => item.id === id)) {
      return;
    }
    const result = removePlacement(settings.deck.pages, pageId, id, settings.skinLayouts);
    if (!result.item) {
      return;
    }
    settings.deck.pages = result.pages;
    settings.skinLayouts = result.skinLayouts;
    if (result.orphanControl) {
      settings.controls = settings.controls.filter((c) => c.id !== result.orphanControl);
      delete settings.variants[result.orphanControl];
    }
    if (selection && 'item' in selection && selection.item === id) {
      selection = null;
    }
  }

  /** Plays the removal animation, then deletes the placement if the editor still shows it. */
  async function removeItemFromPage(id: string, target: LayoutTarget) {
    const pageId = target.pageId;
    const item = layoutFor(settings, target.skinId, pageId, target.slotId)?.items.find(
      (candidate) => candidate.id === id,
    );
    if (!item) {
      return;
    }
    const skinId = editorSkin.id;
    const viewId = previewViewId;
    const generation = pageGeneration;
    const name = controlById(item.control)?.name ?? 'widget';
    await animateRemoval(id);
    const current = layoutFor(settings, target.skinId, pageId, target.slotId);
    const stale =
      page.id !== pageId ||
      editorSkin.id !== skinId ||
      previewViewId !== viewId ||
      pageGeneration !== generation ||
      !visibleSlots.includes(target.slotId) ||
      !current?.items.some((entry) => entry.id === id);
    if (stale) {
      return;
    }
    commit(`Delete ${name}`);
    remove(id, pageId, target);
  }

  function deleteKeydown(event: KeyboardEvent) {
    const ignored =
      !active ||
      event.key !== 'Delete' ||
      event.defaultPrevented ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      menuOpen ||
      moveDialogOpen ||
      scenarioOpen ||
      isEditingText(event.target);
    if (ignored) {
      return;
    }
    const itemId = selection && 'item' in selection ? selection.item : undefined;
    if (itemId) {
      event.preventDefault();
      void removeItemFromPage(itemId, selectionTarget);
      return;
    }
    const focusedTab =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.matches('[data-page-tab][aria-selected="true"]');
    if (focusedTab && settings.deck.pages.length > 1) {
      event.preventDefault();
      void deletePage(selectedPageId);
    }
  }

  function isEditingText(target: EventTarget | null) {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        !!target.closest(
          'input, textarea, select, [role="textbox"], [role="dialog"], [role="alertdialog"]',
        ))
    );
  }

  // ---- paste, duplicate, replace ----

  function insertionPlan(
    copy: WidgetCopy,
    target: Target,
    pageId: string,
    slot: LayoutTarget,
    replace = false,
  ) {
    const editable =
      pageId === page.id &&
      pageId === slot.pageId &&
      editorSkin.id === slot.skinId &&
      visibleSlots.includes(slot.slotId);
    return editable ? planInsertion(settings, copy, target, slot, replace) : undefined;
  }

  function insert(
    copy: WidgetCopy,
    target: Target,
    pageId: string,
    slot: LayoutTarget,
    replace = false,
    label = 'Paste widget',
  ) {
    const plan = insertionPlan(copy, target, pageId, slot, replace);
    const result = plan && insertWidget($state.snapshot(settings), copy, plan, slot, allItems);
    if (!result) {
      toast.error(NO_ROOM);
      return;
    }
    commit(label);
    settings.deck.pages = result.settings.deck.pages;
    settings.skinLayouts = result.settings.skinLayouts;
    settings.controls = result.settings.controls;
    settings.variants = result.settings.variants;
    select({ item: result.itemId }, slot);
  }

  async function paste(copy: WidgetCopy, target: Target, pageId: string, slot: LayoutTarget) {
    const replacing = 'item' in target;
    if (!insertionPlan(copy, target, pageId, slot, replacing)) {
      toast.error(NO_ROOM);
      return;
    }
    if (!replacing) {
      insert(copy, target, pageId, slot);
      return;
    }
    const id = target.item;
    if (!(await confirm({ title: 'Replace widget?', action: 'Replace', destructive: true }))) {
      return;
    }
    const current = layoutFor(settings, slot.skinId, slot.pageId, slot.slotId);
    if (page.id !== pageId || !current?.items.some((item) => item.id === id)) {
      return;
    }
    insert(copy, target, pageId, slot, true, 'Paste over widget');
  }

  // ---- context menu ----

  async function simulate(controlId: string, itemId: string, trigger: Trigger) {
    const result = await dispatchRuntimeTrigger(controlId, itemId, trigger);
    if (result.status === 'rejected') {
      toast.error('Runtime owner is unavailable');
    }
  }

  async function simulateEvent(eventId: string, parameter?: string) {
    if (!(await simulateRuntimeEvent(eventId, parameter))) {
      toast.error('Runtime owner is unavailable');
    }
  }

  function openMenu(
    target: Target,
    x: number,
    y: number,
    layoutTarget: LayoutTarget = editorTarget,
  ) {
    const snapshot: Target =
      'item' in target ? { item: target.item } : { cell: { ...target.cell } };
    context = {
      pageId: page.id,
      layoutTarget,
      target: snapshot,
      x,
      y,
      actions: menuActions(snapshot, page.id, layoutTarget).map((action) => ({ ...action })),
      generation: ++menuGeneration,
    };
    menuOpen = true;
  }

  function menuActions(target: Target, pageId: string, slot: LayoutTarget): MenuAction[] {
    const source = layoutFor(settings, slot.skinId, slot.pageId, slot.slotId);
    if (!source || pageId !== slot.pageId) {
      return [];
    }
    const item = 'item' in target ? source.items.find((i) => i.id === target.item) : undefined;
    const control = item ? controlById(item.control) : undefined;
    const pasteAction: MenuAction = {
      label: 'Paste',
      disabled: !clipboard.value || !('cell' in target ? target.cell : item),
      run: () => {
        const latest = clipboard.value;
        if (latest) {
          void paste(structuredClone($state.snapshot(latest)), target, pageId, slot);
        }
      },
    };
    const edit: MenuAction = { label: 'Edit', run: () => select(target, slot) };
    if (!item || !control) {
      return 'cell' in target ? [edit, pasteAction] : [];
    }

    const eventTitles = new Map(registeredEvents().map((event) => [event.id, event.title]));
    const configured = TRIGGERS.filter(
      (trigger) => control.scenario?.triggers[trigger] !== undefined,
    );
    const running = ($runtimeView.busy[control.id] ?? 0) > 0;
    const actions: MenuAction[] = [
      edit,
      { label: 'Edit scenario', run: () => openScenario(control.id, item.id, 'press') },
      ...configured.map((trigger) => ({
        label: `Simulate ${TRIGGER_LABELS[trigger]}`,
        run: () => void simulate(control.id, item.id, trigger),
      })),
      ...(control.scenario?.events ?? []).map((event) => ({
        label: `Simulate event · ${eventTitles.get(event.eventId) ?? event.eventId}`,
        run: () => void simulateEvent(event.eventId, event.parameter),
      })),
    ];
    if (running) {
      actions.push({ label: 'Stop', run: () => void stopRuntimeControl(control.id) });
    }
    actions.push(
      {
        label: 'Copy',
        run: () => {
          clipboard.value = { control: cloneControl(control), w: item.w, h: item.h };
          void navigator.clipboard?.writeText(JSON.stringify(clipboard.value)).catch(() => {});
        },
      },
      pasteAction,
      {
        label: 'Move to page…',
        disabled: settings.deck.pages.length <= 1,
        run: () => openMoveDialog('page', slot, item.id),
      },
      { label: 'Move to slot…', run: () => openMoveDialog('slot', slot, item.id) },
      {
        label: 'Duplicate',
        run: () => {
          const at = firstFree(source.items, item.w, item.h, source.geometry!);
          if (!at) {
            toast.error(NO_ROOM);
            return;
          }
          const copy = {
            control: { ...cloneControl(control), name: `${control.name} copy` },
            w: item.w,
            h: item.h,
          };
          insert(copy, { cell: at }, pageId, slot, false, `Duplicate ${control.name}`);
        },
      },
      { label: 'Delete', danger: true, run: () => removeItemFromPage(item.id, slot) },
    );
    return actions;
  }

  function openDeckOnEmptyClick(event: MouseEvent) {
    const onWidget =
      event.target instanceof Element &&
      event.target.closest('button, [role="button"], [data-dashboard-tile], [data-editing-chrome]');
    if (!onWidget) {
      openDeckSettings();
    }
  }
</script>

<svelte:window onkeydown={deleteKeydown} />

<div class="flex h-full min-h-0 min-w-0 flex-col overflow-visible">
  <header
    style:padding-right="{frame.inspectorOpen ? inspectorWidth + 16 : 16}px"
    class="flex h-12 min-h-12 shrink-0 items-center gap-2 border-b border-[#262626] bg-[#171717] px-4"
  >
    <PageTabs
      pages={settings.deck.pages}
      bind:selectedPageId
      {active}
      onadd={() => showPage(pageCommands.addPage(page.id))}
      onreorder={pageCommands.reorderPage}
      onrename={pageCommands.renamePage}
      onduplicate={duplicatePage}
      ondelete={deletePage}
    />
    <HistoryControls />
  </header>
  <div
    bind:this={layout}
    class="flex min-h-0 min-w-0 flex-1 overflow-visible"
  >
    <div
      class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-[var(--canvas-surface)]"
    >
      <div
        role="presentation"
        onclick={openDeckOnEmptyClick}
        class="relative grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden"
      >
        <div
          aria-hidden="true"
          class="canvas-grid"
        ></div>
        <div
          class="relative grid h-full min-h-0 w-full min-w-0 place-items-center p-6"
          class:canvas-enter={active && wasInactive}
        >
          {#key `${page.id}:${editorSkin.id}`}
            <SkinLayoutEditor
              skin={editorSkin}
              {page}
              bind:previewViewId
              selected={selection}
              onselect={select}
              oncontext={openMenu}
            />
          {/key}
        </div>
      </div>
    </div>
    <InspectorPane
      {active}
      width={inspectorWidth}
    >
      {#key `${page.id}:${selection && 'item' in selection ? selection.item : 'collection'}`}
        <Inspector
          {page}
          {selection}
          layoutTarget={editorTarget}
          onselect={select}
          oneditScenario={openScenario}
        />
      {/key}
    </InspectorPane>
  </div>
</div>
{#if scenarioOpen && scenarioRequest}
  <ScenarioEditor
    bind:open={scenarioOpen}
    controlId={scenarioRequest.controlId}
    itemId={scenarioRequest.itemId}
    initialTrigger={scenarioRequest.trigger}
  />
{/if}
<MoveWidgetDialog
  open={moveDialogOpen}
  mode={moveRequest?.mode}
  options={moveOptions}
  destination={moveRequest?.destinationKey ?? ''}
  canMove={!!moveDestination}
  ondestination={(value) => {
    if (moveRequest) {
      moveRequest.destinationKey = value;
    }
  }}
  onclose={closeMoveDialog}
  onmove={() => void finishMove()}
/>
{#each menuOpen && context ? [context] : [] as payload (payload.generation)}
  <ContextMenu
    open={menuOpen}
    x={payload.x}
    y={payload.y}
    actions={payload.actions}
    onclose={() => closeMenu(payload.generation)}
  />
{/each}

<style>
  .canvas-grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: radial-gradient(circle, rgb(255 255 255 / 0.07) 1px, transparent 1px);
    background-size: 20px 20px;
    opacity: 0.65;
  }
  .canvas-enter {
    animation: canvas-enter 100ms ease-out;
  }
  @keyframes canvas-enter {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .canvas-enter {
      animation-duration: 0ms;
    }
  }
</style>

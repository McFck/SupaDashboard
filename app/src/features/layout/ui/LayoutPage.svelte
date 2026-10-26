<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Undo from '@lucide/svelte/icons/undo-2';
  import Redo from '@lucide/svelte/icons/redo-2';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Hint } from '$lib/components/ui/tooltip';
  import PaneHandle from '../../../panel/ui/PaneHandle.svelte';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import SkinLayoutEditor from './SkinLayoutEditor.svelte';
  import { animateRemoval } from '../removal';
  import { history, undo, redo, commit } from '../history.svelte';
  import { TRIGGERS, type Trigger } from '../../automation/scenario';
  import {
    dispatchRuntimeTrigger,
    runtimeView,
    simulateRuntimeEvent,
    stopRuntimeControl,
  } from '../../../app/runtime.svelte';
  import { firstFree, fits, type Selection } from '../grid';
  import { registeredEvents, skins } from '../../plugins/registry';
  import { controlById, settings } from '../../settings/state.svelte';
  import {
    addPage as buildPage,
    deletePage as buildDeletePage,
    duplicatePage as buildDuplicatePage,
    MAX_PAGES,
    pageAfterRemoval,
    pageById,
    pageItems,
    removePlacement,
    renamePage as buildRenamePage,
    reorderPage as buildReorderPage,
  } from '../pages';
  import ScenarioEditor from '../../automation/editor/ScenarioEditor.svelte';
  import Inspector from './Inspector.svelte';
  import PageTabs from './PageTabs.svelte';
  import Choice from '../../plugins/ui/Choice.svelte';
  import {
    canSetLayoutItems,
    effectiveSize,
    layoutFor,
    movePlacementToSlot,
    setLayoutItems,
    type LayoutTarget,
  } from '../skin-layouts';
  import type { SkinDef } from '../../skins/definition';
  import ContextMenu, { type MenuAction } from '../../../panel/ui/ContextMenu.svelte';
  import {
    frame,
    layoutPreview,
    saveFrame,
    saveLayoutPreview,
  } from '../../../panel/ui/preferences.svelte';
  import { cloneControl, pasteWidget, type WidgetCopy } from '../layout-actions';
  import { clipboard } from '../widget-clipboard.svelte';

  let { active = true }: { active?: boolean } = $props();
  let selection = $state<Selection>(null);
  let scenarioOpen = $state(false);
  let scenarioRequest = $state<{ controlId: string; itemId: string; trigger?: Trigger } | null>(
    null,
  );
  let layout = $state<HTMLElement>();
  let layoutWidth = $state(0);
  let area = $state<HTMLElement>();
  let box = $state({ w: 0, h: 0 });
  let context = $state<{
    pageId: string;
    layoutTarget: LayoutTarget;
    target: NonNullable<Selection>;
    x: number;
    y: number;
    actions: MenuAction[];
    generation: number;
  } | null>(null);
  let menuOpen = $state(false);
  let menuGeneration = 0;
  let resizing = $state<{ x: number; width: number } | null>(null);
  let wasInactive = $state(false);
  const initialSelectedPageId =
    $runtimeView.activePage || settings.deck.activePage || settings.deck.pages[0].id;
  let selectedPageId = $state(initialSelectedPageId);
  const initialSkinId = settings.skin;
  const safeInitialSkinId = skins.has(initialSkinId) ? initialSkinId : 'deck';
  const initialSkin = skins.get(safeInitialSkinId) ?? skins.get('deck')!;
  const initialView = layoutPreview.views[safeInitialSkinId];
  const safeInitialViewId = initialSkin.views.some((view) => view.id === initialView)
    ? initialView
    : initialSkin.defaultView;
  let selectedSkinId = $state(safeInitialSkinId);
  let previewViewId = $state(safeInitialViewId);
  let selectionTarget = $state<LayoutTarget>({
    skinId: safeInitialSkinId,
    pageId: initialSelectedPageId,
    slotId:
      initialSkin.views.find((view) => view.id === safeInitialViewId)?.slots[0] ??
      initialSkin.slots[0]?.id ??
      'main',
  });
  let previousSkinId = safeInitialSkinId,
    previousViewId = safeInitialViewId;
  let previousActiveSkinId = settings.skin;
  let previousSelectedPageId = initialSelectedPageId;
  let previousPageOrder = settings.deck.pages.map((entry) => entry.id);
  let pageGeneration = 0;
  let moveDialogOpen = $state(false);
  type MoveRequest = {
    mode: 'page' | 'slot';
    sourceTarget: LayoutTarget;
    itemId: string;
    destinationKey: string;
  };
  type MoveOption = { value: string; label: string; disabled: boolean; target: LayoutTarget };
  let moveRequest = $state<MoveRequest | null>(null);
  const page = $derived(pageById(settings.deck.pages, selectedPageId)!);
  const editorSkin = $derived(skins.get(selectedSkinId) ?? skins.get('deck')!);
  const editorTarget = $derived.by(() => {
    const view = editorSkin.views.find((entry) => entry.id === previewViewId);
    if (
      selectionTarget.skinId === editorSkin.id &&
      selectionTarget.pageId === page.id &&
      editorSkin.slots.some((slot) => slot.id === selectionTarget.slotId) &&
      view?.slots.includes(selectionTarget.slotId)
    )
      return selectionTarget;
    return {
      skinId: editorSkin.id,
      pageId: page.id,
      slotId: view?.slots[0] ?? editorSkin.slots[0]?.id ?? 'main',
    };
  });
  const allItems = $derived(pageItems(settings.deck.pages, settings.skinLayouts));
  const moveOptions = $derived.by(() =>
    moveRequest
      ? getMoveOptions(moveRequest.mode, moveRequest.sourceTarget, moveRequest.itemId)
      : [],
  );
  const movePlan = $derived.by(() => {
    const request = moveRequest,
      target = moveOptions.find(
        (option) => option.value === request?.destinationKey && !option.disabled,
      )?.target;
    return request && target ? movePlacementToSlot(settings, request.itemId, target) : undefined;
  });
  const rightWidth = $derived(Math.max(0, Math.min(frame.inspectorWidth, layoutWidth - 32)));
  $effect(() => {
    if (!active) wasInactive = true;
  });
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
    const ids = settings.deck.pages.map((entry) => entry.id);
    const changed =
      ids.length !== previousPageOrder.length ||
      ids.some((id, index) => id !== previousPageOrder[index]);
    if (!changed) return;
    const prior = previousPageOrder;
    previousPageOrder = ids;
    pageGeneration++;
    if (!ids.includes(selectedPageId))
      selectedPageId = pageAfterRemoval(settings.deck.pages, selectedPageId, prior) ?? ids[0];
    if (context) closeMenu(context.generation);
    if (
      moveRequest &&
      (!ids.includes(moveRequest.sourceTarget.pageId) ||
        !moveOptions.some((option) => option.value === moveRequest?.destinationKey))
    )
      closeMoveDialog();
  });
  $effect(() => {
    const current = selectedPageId;
    if (current === previousSelectedPageId) return;
    previousSelectedPageId = current;
    selection = null;
    selectionTarget = defaultTarget(editorSkin, page.id, previewViewId);
    if (context) closeMenu(context.generation);
    scenarioOpen = false;
    closeMoveDialog();
  });
  $effect(() => {
    const skinId = settings.skin;
    if (skinId === previousActiveSkinId) return;
    previousActiveSkinId = skinId;
    const skin = skins.get(skinId);
    if (!skin) return;
    selectedSkinId = skin.id;
    const storedView = layoutPreview.views[skin.id];
    previewViewId = skin.views.some((view) => view.id === storedView)
      ? storedView
      : skin.defaultView;
    selectionTarget = defaultTarget(skin, page.id, previewViewId);
    clearEditorTransient();
  });
  $effect(() => {
    const skinId = selectedSkinId,
      viewId = previewViewId;
    if (skinId === previousSkinId && viewId === previousViewId) return;
    previousSkinId = skinId;
    previousViewId = viewId;
    const skin = skins.get(skinId);
    if (!skin || !skin.views.some((view) => view.id === viewId)) return;
    layoutPreview.views[skinId] = viewId;
    if (
      !skin.views.find((view) => view.id === viewId)?.slots.includes(selectionTarget.slotId) ||
      selectionTarget.skinId !== skinId
    )
      selectionTarget = defaultTarget(skin, page.id, viewId);
    clearEditorTransient();
    saveLayoutPreview();
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
    const selectedId = selection && 'item' in selection ? selection.item : undefined;
    if (
      selectedId &&
      !layoutFor(
        settings,
        editorTarget.skinId,
        editorTarget.pageId,
        editorTarget.slotId,
      )?.items.some((i) => i.id === selectedId)
    )
      selection = null;
  });
  $effect(() => {
    const payload = context;
    if (!menuOpen || !payload) return;
    const current = selection;
    const sameSelection =
      current &&
      ('item' in payload.target
        ? 'item' in current && current.item === payload.target.item
        : 'cell' in current &&
          current.cell.x === payload.target.cell.x &&
          current.cell.y === payload.target.cell.y);
    const target = payload.target;
    const targetPage = settings.deck.pages.find((candidate) => candidate.id === payload.pageId);
    const targetLayout = layoutFor(
      settings,
      payload.layoutTarget.skinId,
      payload.layoutTarget.pageId,
      payload.layoutTarget.slotId,
    );
    const targetExists =
      !!targetPage &&
      !!targetLayout &&
      ('item' in target
        ? targetLayout.items.some((item) => item.id === target.item)
        : !!targetLayout.geometry &&
          target.cell.x >= 0 &&
          target.cell.y >= 0 &&
          target.cell.x < targetLayout.geometry.cols &&
          target.cell.y < targetLayout.geometry.rows);
    if (
      !sameSelection ||
      payload.pageId !== page.id ||
      payload.layoutTarget.skinId !== editorSkin.id ||
      !targetExists
    )
      closeMenu(payload.generation);
  });
  $effect(() => {
    if (active) return;
    if (context) closeMenu(context.generation);
    scenarioOpen = false;
    closeMoveDialog();
    if (resizing) {
      resizing = null;
      saveFrame();
    }
  });
  onDestroy(() => {
    if (context) closeMenu(context.generation);
    closeMoveDialog();
  });
  function defaultTarget(skin: SkinDef, pageId: string, viewId: string): LayoutTarget {
    const view =
      skin.views.find((entry) => entry.id === viewId) ??
      skin.views.find((entry) => entry.id === skin.defaultView);
    return { skinId: skin.id, pageId, slotId: view?.slots[0] ?? skin.slots[0]?.id ?? 'main' };
  }
  function clearEditorTransient() {
    selection = null;
    if (context) closeMenu(context.generation);
    scenarioOpen = false;
    closeMoveDialog();
  }
  function select(s: Selection, target?: LayoutTarget) {
    selection = s;
    if (target) selectionTarget = target;
    if (s) {
      frame.inspectorOpen = true;
      saveFrame();
    }
  }
  function openDeck() {
    select(null);
    frame.inspectorOpen = true;
    saveFrame();
  }
  function openScenario(controlId: string, itemId: string, trigger: Trigger = 'press') {
    scenarioRequest = { controlId, itemId, trigger };
    scenarioOpen = true;
  }
  // The inspector always has content, so it never closes; "close" falls back to the Deck settings.
  frame.inspectorOpen = true;
  function closeInspector() {
    select(null);
  }
  function closeMenu(generation: number) {
    if (context?.generation === generation) menuOpen = false;
  }
  function closeMoveDialog() {
    moveDialogOpen = false;
    moveRequest = null;
  }
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
    const result = buildDuplicatePage(
      settings.deck.pages,
      pageId,
      settings.controls,
      settings.variants,
      settings.skinLayouts,
    );
    if (!result) {
      toast.error('Unable to duplicate page');
      return;
    }
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
    const order = settings.deck.pages.map((entry) => entry.id);
    const generation = pageGeneration;
    if (!(await confirm({ title: 'Delete page?', action: 'Delete', destructive: true }))) return;
    if (
      pageGeneration !== generation ||
      settings.deck.pages.length <= 1 ||
      !settings.deck.pages.some((entry) => entry.id === pageId)
    )
      return;
    const result = buildDeletePage(
      settings.deck.pages,
      pageId,
      settings.controls,
      settings.variants,
      settings.skinLayouts,
    );
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
  function getMoveOptions(
    mode: MoveRequest['mode'],
    sourceTarget: LayoutTarget,
    itemId: string,
  ): MoveOption[] {
    const skin = skins.get(sourceTarget.skinId);
    const visibleSlots = skin?.views.find((view) => view.id === previewViewId)?.slots ?? [];
    const slots = mode === 'page' ? [sourceTarget.slotId] : visibleSlots;
    if (!skin || !visibleSlots.includes(sourceTarget.slotId)) return [];
    return settings.deck.pages.flatMap((candidate) =>
      slots.flatMap((slotId) => {
        const target = { skinId: sourceTarget.skinId, pageId: candidate.id, slotId };
        if (candidate.id === sourceTarget.pageId && slotId === sourceTarget.slotId) return [];
        if (mode === 'page' && candidate.id === sourceTarget.pageId) return [];
        const slot = skin.slots.find((entry) => entry.id === slotId);
        return [
          {
            value: `${candidate.id}::${slotId}`,
            label: mode === 'page' ? candidate.name : `${candidate.name} · ${slot?.id ?? slotId}`,
            disabled: !movePlacementToSlot(settings, itemId, target),
            target,
          },
        ];
      }),
    );
  }
  function openMoveDialog(mode: MoveRequest['mode'], sourceTarget: LayoutTarget, itemId: string) {
    const source = layoutFor(
      settings,
      sourceTarget.skinId,
      sourceTarget.pageId,
      sourceTarget.slotId,
    );
    const options = getMoveOptions(mode, sourceTarget, itemId);
    const firstAvailable = options.find((option) => !option.disabled);
    if (!source?.items.some((item) => item.id === itemId) || !firstAvailable) {
      toast.error('No free space for this widget');
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
    const destination = moveOptions.find(
      (option) => option.value === request?.destinationKey && !option.disabled,
    )?.target;
    const source =
      request &&
      layoutFor(
        settings,
        request.sourceTarget.skinId,
        request.sourceTarget.pageId,
        request.sourceTarget.slotId,
      );
    if (
      !request ||
      !destination ||
      selectedPageId !== request.sourceTarget.pageId ||
      editorSkin.id !== request.sourceTarget.skinId ||
      !source?.items.some((item) => item.id === request.itemId) ||
      !editorSkin.views
        .find((view) => view.id === previewViewId)
        ?.slots.includes(request.sourceTarget.slotId)
    ) {
      closeMoveDialog();
      return;
    }
    const result = movePlacementToSlot(settings, request.itemId, destination);
    if (!result) {
      toast.error('No free space for this widget');
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
  function openMenu(
    target: NonNullable<Selection>,
    x: number,
    y: number,
    layoutTarget: LayoutTarget = editorTarget,
  ) {
    const snapshot: NonNullable<Selection> =
      'item' in target ? { item: target.item } : { cell: { ...target.cell } };
    context = {
      pageId: page.id,
      layoutTarget,
      target: snapshot,
      x,
      y,
      actions: actionsFor(snapshot, page.id, layoutTarget).map((action) => ({ ...action })),
      generation: ++menuGeneration,
    };
    menuOpen = true;
  }
  function moveResize(e: PointerEvent) {
    if (active && resizing)
      frame.inspectorWidth = Math.round(
        Math.max(320, Math.min(640, resizing.width + resizing.x - e.clientX)),
      );
  }
  function stopResize() {
    if (active && resizing) {
      resizing = null;
      saveFrame();
    }
  }
  function remove(id: string, pageId: string, target: LayoutTarget) {
    const source = layoutFor(settings, target.skinId, target.pageId, target.slotId);
    if (target.pageId !== pageId || !source?.items.some((item) => item.id === id)) return;
    const result = removePlacement(settings.deck.pages, pageId, id, settings.skinLayouts);
    if (!result.item) return;
    settings.deck.pages = result.pages;
    settings.skinLayouts = result.skinLayouts;
    if (result.orphanControl) {
      settings.controls = settings.controls.filter((c) => c.id !== result.orphanControl);
      delete settings.variants[result.orphanControl];
    }
    if (selection && 'item' in selection && selection.item === id) selection = null;
  }
  async function removeItemFromPage(id: string, target: LayoutTarget) {
    const pageId = target.pageId;
    const source = layoutFor(settings, target.skinId, target.pageId, target.slotId);
    const item = source?.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const skinId = editorSkin.id,
      viewId = previewViewId,
      generation = pageGeneration;
    const name = controlById(item.control)?.name ?? 'widget';
    await animateRemoval(id);
    const current = layoutFor(settings, target.skinId, pageId, target.slotId);
    if (
      page.id !== pageId ||
      editorSkin.id !== skinId ||
      previewViewId !== viewId ||
      pageGeneration !== generation ||
      !editorSkin.views.find((view) => view.id === viewId)?.slots.includes(target.slotId) ||
      !current?.items.some((entry) => entry.id === id)
    )
      return;
    commit(`Delete ${name}`);
    remove(id, pageId, target);
  }
  function deleteKeydown(event: KeyboardEvent) {
    if (
      !active ||
      event.key !== 'Delete' ||
      event.defaultPrevented ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      menuOpen ||
      moveDialogOpen ||
      scenarioOpen
    )
      return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest(
          'input, textarea, select, [role="textbox"], [role="dialog"], [role="alertdialog"]',
        ))
    )
      return;
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
  function insertionPlan(
    copy: WidgetCopy,
    target: NonNullable<Selection>,
    pageId: string,
    targetLayout: LayoutTarget,
    replace = false,
  ) {
    const visibleSlots = editorSkin.views.find((view) => view.id === previewViewId)?.slots ?? [];
    const current = layoutFor(
      settings,
      targetLayout.skinId,
      targetLayout.pageId,
      targetLayout.slotId,
    );
    if (
      pageId !== page.id ||
      pageId !== targetLayout.pageId ||
      editorSkin.id !== targetLayout.skinId ||
      !visibleSlots.includes(targetLayout.slotId) ||
      !current?.slot ||
      !current.geometry
    )
      return undefined;
    const old =
      'item' in target ? current.items.find((item) => item.id === target.item) : undefined;
    if (('item' in target && !old) || (old && !replace)) return undefined;
    const at = 'cell' in target ? target.cell : old;
    const bounds = effectiveSize(targetLayout.skinId, current.slot, copy.control.type);
    const remaining = old ? current.items.filter((item) => item.id !== old.id) : current.items;
    if (
      !at ||
      !bounds ||
      (current.slot.accepts && !current.slot.accepts.includes(copy.control.type)) ||
      copy.w < bounds.min.w ||
      copy.h < bounds.min.h ||
      copy.w > bounds.max.w ||
      copy.h > bounds.max.h ||
      (current.slot.max !== undefined && remaining.length >= current.slot.max) ||
      !fits(remaining, { ...at, w: copy.w, h: copy.h }, current.geometry)
    )
      return undefined;
    return { current, old, at, remaining };
  }
  function insert(
    copy: WidgetCopy,
    target: NonNullable<Selection>,
    pageId: string,
    targetLayout: LayoutTarget,
    replace = false,
    label = 'Paste widget',
  ) {
    const plan = insertionPlan(copy, target, pageId, targetLayout, replace);
    if (!plan) {
      toast.error('No free space for this widget');
      return;
    }
    const result = pasteWidget(
      copy,
      plan.remaining,
      allItems,
      settings.controls,
      plan.current.geometry!,
      plan.at,
    );
    if (!result) {
      toast.error('No free space for this widget');
      return;
    }

    const draftPages = settings.deck.pages.map((entry) => ({ ...entry, items: [...entry.items] }));
    let draftLayouts = structuredClone($state.snapshot(settings.skinLayouts));
    let draftControls = [...settings.controls];
    let draftVariants = { ...settings.variants };
    if (plan.old) {
      const removed = removePlacement(draftPages, pageId, plan.old.id, draftLayouts);
      if (!removed.item) {
        toast.error('No free space for this widget');
        return;
      }
      draftPages.splice(
        0,
        draftPages.length,
        ...removed.pages.map((entry) => ({ ...entry, items: [...entry.items] })),
      );
      draftLayouts = removed.skinLayouts;
      if (removed.orphanControl) {
        draftControls = draftControls.filter((control) => control.id !== removed.orphanControl);
        delete draftVariants[removed.orphanControl];
      }
    }
    const draft = {
      ...settings,
      deck: { ...settings.deck, pages: draftPages },
      skinLayouts: draftLayouts,
      controls: [...draftControls, result.control],
    };
    const destination = layoutFor(
      draft,
      targetLayout.skinId,
      targetLayout.pageId,
      targetLayout.slotId,
    );
    if (!destination || !setLayoutItems(draft, targetLayout, [...destination.items, result.item])) {
      toast.error('No free space for this widget');
      return;
    }
    commit(label);
    settings.deck.pages = draft.deck.pages;
    settings.skinLayouts = draft.skinLayouts;
    settings.controls = draft.controls;
    settings.variants = draftVariants;
    select({ item: result.item.id }, targetLayout);
  }
  async function pasteSnapshot(
    copy: WidgetCopy,
    target: NonNullable<Selection>,
    pageId: string,
    targetLayout: LayoutTarget,
  ) {
    const replacing = 'item' in target;
    if (!insertionPlan(copy, target, pageId, targetLayout, replacing)) {
      toast.error('No free space for this widget');
      return;
    }
    if (replacing) {
      const id = target.item;
      if (!(await confirm({ title: 'Replace widget?', action: 'Replace', destructive: true })))
        return;
      const current = layoutFor(
        settings,
        targetLayout.skinId,
        targetLayout.pageId,
        targetLayout.slotId,
      );
      if (page.id !== pageId || !current?.items.some((item) => item.id === id)) return;
      insert(copy, target, pageId, targetLayout, true, 'Paste over widget');
      return;
    }
    insert(copy, target, pageId, targetLayout);
  }
  async function simulate(controlId: string, itemId: string, trigger: Trigger) {
    const result = await dispatchRuntimeTrigger(controlId, itemId, trigger);
    if (result.status === 'rejected') toast.error('Runtime owner is unavailable');
  }
  async function simulateEvent(eventId: string, parameter?: string) {
    if (!(await simulateRuntimeEvent(eventId, parameter)))
      toast.error('Runtime owner is unavailable');
  }
  function actionsFor(
    target: NonNullable<Selection>,
    pageId: string,
    targetLayout: LayoutTarget = editorTarget,
  ): MenuAction[] {
    const sourceLayout = layoutFor(
      settings,
      targetLayout.skinId,
      targetLayout.pageId,
      targetLayout.slotId,
    );
    if (!sourceLayout || pageId !== targetLayout.pageId) return [];
    const item =
      'item' in target ? sourceLayout.items.find((i) => i.id === target.item) : undefined;
    const control = item ? controlById(item.control) : undefined;
    const copy = clipboard.value;
    const pasteAt = 'cell' in target ? target.cell : item;
    const paste: MenuAction = {
      label: 'Paste',
      disabled: !copy || !pasteAt,
      run: () => {
        const latest = clipboard.value;
        if (!latest) return;
        const snapshot = structuredClone($state.snapshot(latest));
        const targetSnapshot: NonNullable<Selection> =
          'item' in target ? { item: target.item } : { cell: { ...target.cell } };
        void pasteSnapshot(snapshot, targetSnapshot, pageId, targetLayout);
      },
    };
    if (!item || !control) {
      if (!('cell' in target)) return [];
      return [{ label: 'Edit', run: () => select(target, targetLayout) }, paste];
    }
    const configured = TRIGGERS.filter(
      (trigger) => control.scenario?.triggers[trigger] !== undefined,
    );
    const labels: Record<Trigger, string> = {
      press: 'Press',
      release: 'Release',
      longPress: 'Long press',
      longPressRelease: 'Long press release',
      doubleTap: 'Double tap',
      swipeUp: 'Pull up',
      swipeDown: 'Pull down',
      swipeLeft: 'Pull left',
      swipeRight: 'Pull right',
    };
    const eventTitles = new Map(registeredEvents().map((event) => [event.id, event.title]));
    const running = ($runtimeView.busy[control.id] ?? 0) > 0;
    return [
      { label: 'Edit', run: () => select(target, targetLayout) },
      { label: 'Edit scenario', run: () => openScenario(control.id, item.id, 'press') },
      ...configured.map((trigger) => ({
        label: 'Simulate ' + labels[trigger],
        run: () => {
          void simulate(control.id, item.id, trigger);
        },
      })),
      ...(control.scenario?.events.map((event) => ({
        label: `Simulate event · ${eventTitles.get(event.eventId) ?? event.eventId}`,
        run: () => {
          void simulateEvent(event.eventId, event.parameter);
        },
      })) ?? []),
      ...(running
        ? [
            {
              label: 'Stop',
              run: () => {
                void stopRuntimeControl(control.id);
              },
            },
          ]
        : []),
      {
        label: 'Copy',
        run: () => {
          clipboard.value = { control: cloneControl(control), w: item.w, h: item.h };
          void navigator.clipboard?.writeText(JSON.stringify(clipboard.value)).catch(() => {});
        },
      },
      paste,
      {
        label: 'Move to page…',
        disabled: settings.deck.pages.length <= 1,
        run: () => openMoveDialog('page', targetLayout, item.id),
      },
      { label: 'Move to slot…', run: () => openMoveDialog('slot', targetLayout, item.id) },
      {
        label: 'Duplicate',
        run: () => {
          const at = firstFree(sourceLayout.items, item.w, item.h, sourceLayout.geometry!);
          if (!at) {
            toast.error('No free space for this widget');
            return;
          }
          insert(
            {
              control: { ...cloneControl(control), name: `${control.name} copy` },
              w: item.w,
              h: item.h,
            },
            { cell: at },
            pageId,
            targetLayout,
            false,
            `Duplicate ${control.name}`,
          );
        },
      },
      {
        label: 'Delete',
        danger: true,
        run: async () => {
          await removeItemFromPage(item.id, targetLayout);
        },
      },
    ];
  }
</script>

<svelte:window
  onkeydown={deleteKeydown}
  onpointermove={moveResize}
  onpointerup={stopResize}
  onpointercancel={stopResize}
  onblur={stopResize}
/>
<div class="flex h-full min-h-0 min-w-0 flex-col overflow-visible">
  <header
    style:padding-right="{frame.inspectorOpen ? rightWidth + 16 : 16}px"
    class="flex h-12 min-h-12 shrink-0 items-center gap-2 border-b border-[#262626] bg-[#171717] px-4"
  >
    <PageTabs
      pages={settings.deck.pages}
      bind:selectedPageId
      {active}
      onadd={addPage}
      onreorder={reorderPages}
      onrename={renamePage}
      onduplicate={duplicatePage}
      ondelete={deletePage}
    />
    <div class="flex shrink-0 items-center gap-1.5 border-l border-[#262626] pl-3">
      <Hint
        text="Undo"
        keys={['Ctrl', 'Z']}
        side="bottom"
        >{#snippet children(props)}<Button
            {...props}
            variant="ghost"
            size="icon-sm"
            aria-label="Undo"
            disabled={!history.canUndo}
            onclick={undo}><Undo /></Button
          >{/snippet}</Hint
      >
      <Hint
        text="Redo"
        keys={['Ctrl', 'Shift', 'Z']}
        side="bottom"
        >{#snippet children(props)}<Button
            {...props}
            variant="ghost"
            size="icon-sm"
            aria-label="Redo"
            disabled={!history.canRedo}
            onclick={redo}><Redo /></Button
          >{/snippet}</Hint
      >
    </div>
  </header>
  <div
    bind:this={layout}
    class="flex min-h-0 min-w-0 flex-1 overflow-visible"
  >
    <div
      class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-[var(--canvas-surface)]"
    >
      <div
        bind:this={area}
        role="presentation"
        onclick={(e) => {
          if (
            e.target instanceof Element &&
            !e.target.closest(
              'button, [role="button"], [data-dashboard-tile], [data-editing-chrome]',
            )
          )
            openDeck();
        }}
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
    <div
      class="right-slot relative min-h-0 shrink-0 overflow-visible"
      class:resizing={resizing !== null}
      class:inactive={!active}
      style:width="{frame.inspectorOpen ? rightWidth : 0}px"
    >
      <PaneHandle
        label="Resize inspector"
        active={resizing !== null}
        class="bottom-0 -left-1.5 top-0"
        onpointerdown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          resizing = { x: e.clientX, width: frame.inspectorWidth };
        }}
        onkeydown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            frame.inspectorWidth = Math.max(
              320,
              Math.min(640, frame.inspectorWidth + (e.key === 'ArrowLeft' ? 16 : -16)),
            );
            saveFrame();
          }
        }}
      />
      <section
        aria-label="Inspector"
        aria-hidden={!frame.inspectorOpen}
        inert={!frame.inspectorOpen}
        style:width="{rightWidth}px"
        style:display={frame.inspectorOpen ? undefined : 'none'}
        class="right-panel absolute -top-12 bottom-0 left-0 z-10 flex min-h-0 flex-col overflow-hidden bg-sidebar"
        class:open={frame.inspectorOpen}
      >
        <div
          aria-hidden="true"
          class="pointer-events-none absolute inset-y-0 left-0 z-10 w-px bg-[#262626]"
        ></div>
        <div class="inspector-content min-h-0 flex-1 overflow-hidden">
          {#key `${page.id}:${selection && 'item' in selection ? selection.item : 'collection'}`}
            <Inspector
              {page}
              {selection}
              layoutTarget={editorTarget}
              onselect={select}
              oneditScenario={openScenario}
              onclose={closeInspector}
            />
          {/key}
        </div>
      </section>
    </div>
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
<Dialog.Root
  open={moveDialogOpen}
  onOpenChange={(open) => {
    if (!open) closeMoveDialog();
  }}
>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header
      ><Dialog.Title>{moveRequest?.mode === 'slot' ? 'Move to slot' : 'Move to page'}</Dialog.Title
      ></Dialog.Header
    >
    <Choice
      value={moveRequest?.destinationKey ?? ''}
      options={moveOptions}
      aria-label={moveRequest?.mode === 'slot' ? 'Destination slot' : 'Destination page'}
      onchange={(value) => {
        if (moveRequest) moveRequest.destinationKey = value;
      }}
    />
    <Dialog.Footer class="flex justify-end gap-2">
      <Button
        variant="ghost"
        size="sm"
        onclick={closeMoveDialog}>Cancel</Button
      >
      <Button
        size="sm"
        disabled={!moveRequest || !movePlan}
        onclick={() => void finishMove()}>Move</Button
      >
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
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
  /* shadcn Sidebar style: the slot animates its width and the panel rides its left edge, so it slides in and out. */
  .right-slot {
    transition: width 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .right-slot.inactive {
    transition: none;
  }
  .right-slot.resizing {
    transition: none;
  }
  .inspector-content :global(aside) {
    min-height: 0;
    overflow: hidden;
  }
  @media (prefers-reduced-motion: reduce) {
    .canvas-enter {
      animation-duration: 0ms;
    }
    .right-slot {
      transition: none;
    }
  }
</style>

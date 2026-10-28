<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import SkinLayoutEditor from './SkinLayoutEditor.svelte';
  import { duplicateInSlot, moveToSlot, pasteInSlot, removeWithDust } from '../slot-edits';
  import { TRIGGER_LABELS, TRIGGERS, type Trigger } from '../../automation/scenario';
  import { runtimeView } from '../../../app/runtime/state';
  import type { Selection } from '../grid';
  import { registeredEvents, skins } from '../../plugins/registry';
  import { controlById, settings } from '../../settings/state.svelte';
  import { MAX_PAGES } from '../pages';
  import * as pageCommands from '../page-commands';
  import ScenarioEditor from '../../automation/editor/ScenarioEditor.svelte';
  import Inspector from './Inspector.svelte';
  import PageTabs from './PageTabs.svelte';
  import HistoryControls from './HistoryControls.svelte';
  import InspectorPane from './InspectorPane.svelte';
  import MoveWidgetDialog from './MoveWidgetDialog.svelte';
  import { layoutFor, type LayoutTarget } from '../skin-layouts';
  import { LayoutEditorState } from './editor-state.svelte';
  import ContextMenu, { type MenuAction } from '../../../panel/ui/ContextMenu.svelte';
  import { frame } from '../../../panel/ui/preferences.svelte';
  import { clipboard } from '../widget-clipboard.svelte';
  import { cloneControl, planInsertion, type WidgetCopy } from '../widget-insert';
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

  const editor = new LayoutEditorState({
    pagesChanged(ids) {
      closeCurrentMenu();
      const request = moveRequest;
      if (
        request &&
        (!ids.includes(request.sourceTarget.pageId) ||
          !moveOptions.some((option) => option.value === request.destinationKey))
      ) {
        closeMoveDialog();
      }
    },
    leave() {
      closeCurrentMenu();
      scenarioOpen = false;
      closeMoveDialog();
    },
  });
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

  // Close the context menu once its target is no longer what it was opened for.
  $effect(() => {
    const payload = context;
    if (!menuOpen || !payload) {
      return;
    }
    const stillTargeted =
      sameTarget(editor.selection, payload.target) &&
      payload.pageId === editor.page.id &&
      payload.layoutTarget.skinId === editor.skin.id &&
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

  function openDeckSettings() {
    editor.select(null);
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

  function duplicatePage(pageId: string) {
    if (settings.deck.pages.length >= MAX_PAGES) {
      return;
    }
    const copyId = pageCommands.duplicatePage(pageId);
    if (!copyId) {
      toast.error('Unable to duplicate page');
      return;
    }
    editor.showPage(copyId);
  }

  async function deletePage(pageId: string) {
    const generation = editor.pageGeneration;
    if (!(await confirm({ title: 'Delete page?', action: 'Delete', destructive: true }))) {
      return;
    }
    if (editor.pageGeneration === generation) {
      editor.showPage(pageCommands.deletePage(pageId));
    }
  }

  // ---- moving a widget to another page or slot ----

  function optionsFor(mode: MoveMode, sourceTarget: LayoutTarget, itemId: string) {
    const skin = skins.get(sourceTarget.skinId);
    const slots = skin?.views.find((view) => view.id === editor.viewId)?.slots ?? [];
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
    const moved = moveToSlot(request.itemId, destination);
    if (!moved) {
      toast.error(NO_ROOM);
      return;
    }
    editor.pageId = destination.pageId;
    editor.selectionTarget = destination;
    closeMoveDialog();
    await tick();
    editor.select({ item: moved.id }, destination);
  }

  function moveSourceStillShown(request: MoveRequest) {
    const { skinId, pageId, slotId } = request.sourceTarget;
    const source = layoutFor(settings, skinId, pageId, slotId);
    return (
      editor.pageId === pageId &&
      editor.skin.id === skinId &&
      !!source?.items.some((item) => item.id === request.itemId) &&
      editor.visibleSlots.includes(slotId)
    );
  }

  // ---- removing ----

  /** Plays the removal animation, then deletes the placement if the editor still shows it. */
  function removeItemFromPage(id: string, target: LayoutTarget) {
    const stillShown = editor.watch(target);
    void removeWithDust(target, id, stillShown).then((removed) => {
      if (
        removed &&
        editor.selection &&
        'item' in editor.selection &&
        editor.selection.item === id
      ) {
        editor.selection = null;
      }
    });
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
    const itemId =
      editor.selection && 'item' in editor.selection ? editor.selection.item : undefined;
    if (itemId) {
      event.preventDefault();
      removeItemFromPage(itemId, editor.selectionTarget);
      return;
    }
    const focusedTab =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.matches('[data-page-tab][aria-selected="true"]');
    if (focusedTab && settings.deck.pages.length > 1) {
      event.preventDefault();
      void deletePage(editor.pageId);
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

  function placed(id: string | undefined, slot: LayoutTarget) {
    if (!id) {
      toast.error(NO_ROOM);
      return;
    }
    editor.select({ item: id }, slot);
  }

  function insert(
    copy: WidgetCopy,
    target: Target,
    pageId: string,
    slot: LayoutTarget,
    label = 'Paste widget',
  ) {
    placed(editor.shows(pageId, slot) ? pasteInSlot(slot, copy, target, label) : undefined, slot);
  }

  async function paste(copy: WidgetCopy, target: Target, pageId: string, slot: LayoutTarget) {
    if (!editor.shows(pageId, slot) || !planInsertion(settings, copy, target, slot)) {
      toast.error(NO_ROOM);
      return;
    }
    if (!('item' in target)) {
      insert(copy, target, pageId, slot);
      return;
    }
    const id = target.item;
    if (!(await confirm({ title: 'Replace widget?', action: 'Replace', destructive: true }))) {
      return;
    }
    const current = layoutFor(settings, slot.skinId, slot.pageId, slot.slotId);
    if (editor.page.id !== pageId || !current?.items.some((item) => item.id === id)) {
      return;
    }
    insert(copy, target, pageId, slot, 'Paste over widget');
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
    layoutTarget: LayoutTarget = editor.target,
  ) {
    const snapshot: Target =
      'item' in target ? { item: target.item } : { cell: { ...target.cell } };
    context = {
      pageId: editor.page.id,
      layoutTarget,
      target: snapshot,
      x,
      y,
      actions: menuActions(snapshot, editor.page.id, layoutTarget).map((action) => ({ ...action })),
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
    const edit: MenuAction = { label: 'Edit', run: () => editor.select(target, slot) };
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
        run: () =>
          placed(editor.shows(pageId, slot) ? duplicateInSlot(slot, item.id) : undefined, slot),
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
    style:padding-right="{inspectorWidth + 16}px"
    class="flex h-12 min-h-12 shrink-0 items-center gap-2 border-b border-[#262626] bg-[#171717] px-4"
  >
    <PageTabs
      pages={settings.deck.pages}
      bind:selectedPageId={editor.pageId}
      {active}
      onadd={() => editor.showPage(pageCommands.addPage(editor.page.id))}
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
          {#key `${editor.page.id}:${editor.skin.id}`}
            <SkinLayoutEditor
              skin={editor.skin}
              page={editor.page}
              bind:previewViewId={editor.viewId}
              selected={editor.selection}
              onselect={(next, target) => editor.select(next, target)}
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
      {#key `${editor.page.id}:${editor.selection && 'item' in editor.selection ? editor.selection.item : 'collection'}`}
        <Inspector
          page={editor.page}
          selection={editor.selection}
          layoutTarget={editor.target}
          onselect={(next, target) => editor.select(next, target)}
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

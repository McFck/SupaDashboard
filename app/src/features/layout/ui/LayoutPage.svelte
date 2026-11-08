<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { Trigger } from '../../automation/scenario';
  import { settings } from '../../settings/state.svelte';
  import ContextMenu from '../../../panel/ui/ContextMenu.svelte';
  import { LayoutMenu } from './layout-menu.svelte';
  import { WidgetMove } from './widget-move.svelte';
  import { toast } from 'svelte-sonner';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import AppletLayoutEditor from './AppletLayoutEditor.svelte';
  import { MAX_PAGES } from '../pages';
  import * as pageCommands from '../page-commands';
  import ScenarioEditor from '../../automation/editor/ScenarioEditor.svelte';
  import Inspector from './Inspector.svelte';
  import PageTabs from './PageTabs.svelte';
  import HistoryControls from './HistoryControls.svelte';
  import InspectorPane from './InspectorPane.svelte';
  import MoveWidgetDialog from './MoveWidgetDialog.svelte';
  import { LayoutEditorState } from './editor-state.svelte';
  import { frame } from '../../../panel/ui/preferences.svelte';
  import { runtimeCommands } from '../../../app/runtime/commands';

  /** Keeps the canvas visible beside the inspector. */
  const CANVAS_MIN_WIDTH = 32;

  let { active = true, onopenplugin }: { active?: boolean; onopenplugin: (id: string) => void } =
    $props();

  let scenarioOpen = $state(false);
  let scenarioRequest = $state<{ controlId: string; itemId: string; trigger?: Trigger } | null>(
    null,
  );
  let layout = $state<HTMLElement>();
  let layoutWidth = $state(0);
  let wasInactive = $state(false);

  const editor = new LayoutEditorState({
    pagesChanged(ids) {
      menu.closeCurrentMenu();
      move.pagesChanged(ids);
    },
    leave() {
      menu.closeCurrentMenu();
      scenarioOpen = false;
      move.closeMoveDialog();
    },
  });
  const move = new WidgetMove(editor);
  const menu = new LayoutMenu(editor, runtimeCommands, {
    openScenario,
    openMove: (mode, target, itemId) => move.openMoveDialog(mode, target, itemId),
  });
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

  $effect(() => {
    if (active) {
      return;
    }
    menu.closeCurrentMenu();
    scenarioOpen = false;
    move.closeMoveDialog();
  });

  function openDeckSettings() {
    editor.select(null);
  }

  function openScenario(controlId: string, itemId: string, trigger: Trigger = 'press') {
    scenarioRequest = { controlId, itemId, trigger };
    scenarioOpen = true;
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

  function deleteKeydown(event: KeyboardEvent) {
    const ignored =
      !active ||
      event.key !== 'Delete' ||
      event.defaultPrevented ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      menu.open ||
      move.open ||
      scenarioOpen ||
      isEditingText(event.target);
    if (ignored) {
      return;
    }
    const itemId =
      editor.selection && 'item' in editor.selection ? editor.selection.item : undefined;
    if (itemId) {
      event.preventDefault();
      menu.removeItemFromPage(itemId, editor.selectionTarget);
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
    class="flex h-12 min-h-12 shrink-0 items-center gap-2 bg-background px-4"
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
    {#if editor.applet.plugin}
      {@const pluginId = editor.applet.plugin}
      <Button
        variant="ghost"
        size="sm"
        class="ml-auto"
        onclick={() => onopenplugin(pluginId)}>Settings</Button
      >
    {/if}
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
          {#key `${editor.page.id}:${editor.applet.id}`}
            <AppletLayoutEditor
              applet={editor.applet}
              page={editor.page}
              bind:previewViewId={editor.viewId}
              selected={editor.selection}
              onselect={(next, target) => editor.select(next, target)}
              oncontext={(target, x, y, slot) => menu.openMenu(target, x, y, slot)}
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
<!-- Stays mounted after closing so the dialog's exit animation can play; a new request remounts it fresh. -->
{#if scenarioRequest}
  {#key scenarioRequest}
    <ScenarioEditor
      bind:open={scenarioOpen}
      controlId={scenarioRequest.controlId}
      itemId={scenarioRequest.itemId}
      initialTrigger={scenarioRequest.trigger}
    />
  {/key}
{/if}
<MoveWidgetDialog
  open={move.open}
  mode={move.request?.mode}
  options={move.options}
  destination={move.request?.destinationKey ?? ''}
  ondestination={(value) => move.choose(value)}
  onclose={() => move.closeMoveDialog()}
  onmove={() => void move.finishMove()}
/>
{#each menu.open && menu.context ? [menu.context] : [] as payload (payload.generation)}
  <ContextMenu
    open={menu.open}
    x={payload.x}
    y={payload.y}
    actions={payload.actions}
    onclose={() => menu.closeMenu(payload.generation)}
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

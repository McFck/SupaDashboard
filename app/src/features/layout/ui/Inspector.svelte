<script lang="ts">
  // Right-hand panel of the layout editor. Everything edits the live settings, so the dashboard updates as you type.
  import type { Trigger } from '../../automation/scenario';
  import { controlTypes } from '../../plugins/registry';
  import { controlById, settings } from '../../settings/state.svelte';
  import type { Page } from '../../settings/schema';
  import type { Selection } from '../grid';
  import { layoutFor, type LayoutTarget } from '../skin-layouts';
  import AddWidgetPicker from './AddWidgetPicker.svelte';
  import DeckSettings from './DeckSettings.svelte';
  import WidgetInspector from './WidgetInspector.svelte';

  let {
    selection,
    onselect,
    oneditScenario,
    page,
    layoutTarget,
  }: {
    selection: Selection;
    onselect: (s: Selection, target?: LayoutTarget) => void;
    oneditScenario: (controlId: string, itemId: string, trigger?: Trigger) => void;
    page: Page;
    layoutTarget: LayoutTarget;
  } = $props();

  const target = $derived(
    layoutFor(settings, layoutTarget.skinId, layoutTarget.pageId, layoutTarget.slotId),
  );
  const item = $derived(
    selection && 'item' in selection
      ? target?.items.find((entry) => entry.id === selection.item)
      : undefined,
  );
  const control = $derived(item ? controlById(item.control) : undefined);
  const cell = $derived(selection && 'cell' in selection ? selection.cell : undefined);
</script>

<aside class="flex h-full w-full min-w-0 flex-col bg-sidebar">
  {#if control && item && controlTypes.has(control.type)}
    <WidgetInspector
      {control}
      {item}
      {layoutTarget}
      {onselect}
      {oneditScenario}
    />
  {:else if cell}
    <AddWidgetPicker
      {cell}
      {layoutTarget}
      {onselect}
    />
  {:else if layoutTarget.skinId === 'deck'}
    <DeckSettings {page} />
  {:else}
    <header class="flex h-12 shrink-0 items-center px-4">
      <p class="flex-1 font-semibold">{target?.slot?.id ?? 'Slot'}</p>
    </header>
  {/if}
</aside>

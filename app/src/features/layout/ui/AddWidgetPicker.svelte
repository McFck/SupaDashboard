<script lang="ts">
  // The inspector for an empty cell: add a new widget of any type, or place a copy of an existing control.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { toast } from 'svelte-sonner';
  import { Input } from '$lib/components/ui/input';
  import Icon from '../../controls/ui/Icon.svelte';
  import type { ControlConfig } from '../../controls/model';
  import { normalizeControl } from '../../automation/normalize-control';
  import { controlTypes } from '../../plugins/registry';
  import PluginMark, { pluginTitle } from '../../plugins/ui/PluginMark.svelte';
  import { settings } from '../../settings/state.svelte';
  import { buildExistingControlRows, searchExistingControls } from '../existing-controls';
  import { cloneControl } from '../widget-insert';
  import { pageItems } from '../placements';
  import { effectiveSize, layoutFor, type LayoutTarget } from '../skin-layouts';
  import { findSlotPlacement, newControlId, placeControl } from '../slot-edits';
  import type { Selection } from '../grid';

  const NO_ROOM = 'No free space for this widget';

  let {
    cell,
    layoutTarget,
    onselect,
  }: {
    cell: { x: number; y: number };
    layoutTarget: LayoutTarget;
    onselect: (selection: Selection, target?: LayoutTarget) => void;
  } = $props();

  let existingOpen = $state(true);
  let existingQuery = $state('');

  const slot = $derived(
    layoutFor(settings, layoutTarget.skinId, layoutTarget.pageId, layoutTarget.slotId)?.slot,
  );
  const allItems = $derived(pageItems(settings.deck.pages, settings.skinLayouts));
  const existingRows = $derived(
    buildExistingControlRows(settings.controls, allItems, controlTypes).filter(
      (row) => row.uses > 0 && !!fitFor(row.typeId),
    ),
  );
  const filteredRows = $derived(searchExistingControls(existingRows, existingQuery));

  const fitFor = (typeId: string) => findSlotPlacement(layoutTarget, typeId, { cell });

  function place(control: ControlConfig, label: string) {
    const at = fitFor(control.type);
    const id = at && placeControl(layoutTarget, control, at, label);
    if (!id) {
      toast.error(NO_ROOM);
      return;
    }
    onselect({ item: id }, layoutTarget);
  }

  function addNew(typeId: string) {
    const type = controlTypes.get(typeId);
    if (!type) {
      return;
    }
    const control = normalizeControl({
      id: newControlId(type.title),
      type: typeId,
      ...structuredClone(type.create()),
    });
    place(control, `Add ${type.title}`);
  }

  /** Places an independent copy: each placed widget keeps its own state. */
  function placeExisting(controlId: string) {
    const existing = settings.controls.find((control) => control.id === controlId);
    if (!existing || !controlTypes.has(existing.type)) {
      return;
    }
    const copy = {
      ...cloneControl($state.snapshot(existing) as ControlConfig),
      id: newControlId(existing.id),
    };
    place(copy, 'Add widget');
  }

  function rowLabel(
    row: (typeof filteredRows)[number],
    providerTitle: string | undefined,
    fits: boolean,
  ) {
    const plugin = providerTitle ? `, Plugin: ${providerTitle}` : '';
    const uses = `${row.uses} ${row.uses === 1 ? 'use' : 'uses'}`;
    const unavailable = row.available ? '' : ', unavailable';
    const room = fits ? '' : ', no free space';
    return `${row.name}, ${row.typeTitle}${plugin}, ${uses}${unavailable}${room}`;
  }
</script>

<header class="flex h-12 shrink-0 items-center border-b border-[#262626] px-4">
  <p class="flex-1 font-semibold">Add widget</p>
</header>
<div
  class="grid min-h-0 min-w-0 flex-1 content-start gap-2 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]"
>
  {#each [...controlTypes.values()] as type (type.type)}
    {@const bounds = slot && effectiveSize(layoutTarget.skinId, slot, type.type)}
    {@const fit = bounds ? fitFor(type.type) : null}
    {#if bounds && (!slot?.accepts || slot.accepts.includes(type.type))}
      <button
        type="button"
        aria-disabled={!fit}
        onclick={() => addNew(type.type)}
        class:opacity-45={!fit}
        class="flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.02] p-3 text-left transition hover:border-white/20 hover:bg-white/[.05]"
      >
        <span class="grid size-10 place-items-center rounded-lg bg-white/5">
          <Icon
            name={type.icon}
            size={20}
          />
        </span>
        <span class="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
          <span class="min-w-0 truncate">{type.title}</span>
          <PluginMark plugin={type.plugin} />
        </span>
        <span class="text-xs tabular-nums text-muted-foreground">
          {fit?.w ?? type.size.w}×{fit?.h ?? type.size.h}
        </span>
      </button>
    {/if}
  {/each}
  {#if existingRows.length}
    <details
      bind:open={existingOpen}
      class="mt-3 min-w-0"
    >
      <summary
        class="flex cursor-pointer list-none items-center gap-2 rounded-md py-2 text-xs font-semibold text-muted-foreground outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden"
      >
        <ChevronDown
          class="size-4 shrink-0 transition-transform motion-reduce:transition-none {existingOpen
            ? 'rotate-180'
            : ''}"
        />
        <span class="flex-1">Existing</span>
        <span class="tabular-nums">{existingRows.length}</span>
      </summary>
      <div class="grid min-w-0 gap-2 pt-2">
        <Input
          aria-label="Search existing controls"
          placeholder="Search controls"
          bind:value={existingQuery}
        />
        <div
          class="grid min-h-0 max-h-[min(360px,45dvh)] gap-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]"
        >
          {#each filteredRows as row (row.id)}
            {@const type = controlTypes.get(row.typeId)}
            {@const fit = type ? fitFor(row.typeId) : null}
            <button
              type="button"
              disabled={!row.available}
              aria-disabled={!fit || !row.available}
              aria-label={rowLabel(row, pluginTitle(type?.plugin), !!fit)}
              onclick={() => placeExisting(row.id)}
              class:opacity-45={!fit}
              class="flex min-w-0 items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left outline-none transition-colors hover:border-white/10 hover:bg-white/[.04] focus-visible:border-white/20 focus-visible:bg-white/[.05] disabled:pointer-events-none disabled:opacity-45"
            >
              <span class="grid size-8 shrink-0 place-items-center rounded-md bg-white/5">
                <Icon
                  name={row.icon}
                  size={18}
                />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{row.name}</span>
                <span class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <span class="min-w-0 truncate">{row.typeTitle}</span>
                  <PluginMark plugin={type?.plugin} />
                </span>
              </span>
              <span
                class="shrink-0 text-xs tabular-nums text-muted-foreground"
                aria-label="Used in {row.uses} placements"
              >
                {row.uses}
                {row.uses === 1 ? 'use' : 'uses'}
              </span>
            </button>
          {:else}
            <p class="py-3 text-center text-sm text-muted-foreground">No results</p>
          {/each}
        </div>
      </div>
    </details>
  {/if}
</div>

<script lang="ts">
  // The inspector for a selected placement: name, size, the type's own editor and its scenario triggers.
  import Copy from '@lucide/svelte/icons/copy';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import ColorField from '$lib/components/ColorField.svelte';
  import type { ControlConfig } from '../../controls/model';
  import type { Trigger } from '../../automation/scenario';
  import { controlTypes } from '../../plugins/registry';
  import GestureEditor from '../../controls/editor/GestureEditor.svelte';
  import MixerEditor from '../../controls/editor/MixerEditor.svelte';
  import MediaEditor from '../../controls/editor/MediaEditor.svelte';
  import WebEditor from '../../controls/editor/WebEditor.svelte';
  import type { Item, Selection } from '../grid';
  import { effectiveSize, layoutFor, type LayoutTarget } from '../skin-layouts';
  import { settings } from '../../settings/state.svelte';
  import { duplicateInSlot, removeWithDust, resizeInSlot } from '../slot-edits';
  import VariantList from './VariantList.svelte';

  type Axis = 'w' | 'h';

  const AXES: { key: Axis; label: string }[] = [
    { key: 'w', label: 'Width' },
    { key: 'h', label: 'Height' },
  ];

  let {
    control,
    item,
    layoutTarget,
    onselect,
    oneditScenario,
  }: {
    control: ControlConfig;
    item: Item;
    layoutTarget: LayoutTarget;
    onselect: (selection: Selection, target?: LayoutTarget) => void;
    oneditScenario: (controlId: string, itemId: string, trigger?: Trigger) => void;
  } = $props();

  const title = $derived(controlTypes.get(control.type)?.title ?? control.type);
  const bounds = $derived.by(() => {
    const slot = layoutFor(
      settings,
      layoutTarget.skinId,
      layoutTarget.pageId,
      layoutTarget.slotId,
    )?.slot;
    return slot && effectiveSize(layoutTarget.skinId, slot, control.type);
  });

  function resizeBy(axis: Axis, delta: number) {
    const size = { w: item.w, h: item.h };
    size[axis] += delta;
    resizeInSlot(layoutTarget, item.id, size);
  }

  function duplicate() {
    const id = duplicateInSlot(layoutTarget, item.id);
    if (!id) {
      toast.error('No free space for this widget');
      return;
    }
    onselect({ item: id }, layoutTarget);
  }

  /** Deletes the placement after its removal animation if the inspector still shows that slot. */
  async function remove() {
    const target = { ...layoutTarget };
    const removed = await removeWithDust(
      target,
      item.id,
      () =>
        layoutTarget.skinId === target.skinId &&
        layoutTarget.pageId === target.pageId &&
        layoutTarget.slotId === target.slotId,
    );
    if (removed) {
      onselect(null, layoutTarget);
    }
  }

  const editScenario = (trigger?: Trigger) => oneditScenario(control.id, item.id, trigger);
</script>

{#snippet scenarioSection()}
  <section class="grid gap-3">
    <h3 class="section-label">Scenario</h3>
    <GestureEditor
      {control}
      onedit={editScenario}
    />
  </section>
{/snippet}

<header class="flex h-12 shrink-0 items-center gap-3 px-4">
  <p class="min-w-0 flex-1 truncate font-display text-base font-semibold tracking-wide">{title}</p>
  <Button
    size="icon-sm"
    variant="ghost"
    aria-label="Duplicate"
    onclick={duplicate}
  >
    <Copy />
  </Button>
  <Button
    size="icon-sm"
    variant="ghost"
    class="text-destructive hover:bg-destructive/10 hover:text-destructive"
    aria-label="Delete"
    onclick={remove}
  >
    <Trash />
  </Button>
</header>
<div
  class="grid min-h-0 min-w-0 flex-1 content-start gap-7 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]"
>
  <div class="grid gap-1.5">
    <label
      class="section-label"
      for="wname">Name</label
    >
    <Input
      id="wname"
      bind:value={control.name}
    />
  </div>
  <div class="grid gap-1.5">
    <h3 class="section-label">Size</h3>
    <div class="grid grid-cols-2 gap-3 text-sm">
      {#each AXES as axis (axis.key)}
        <div class="grid gap-2">
          <span class="text-sm text-muted-foreground">{axis.label}</span>
          <div class="flex items-center gap-2">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Decrease {axis.label.toLowerCase()}"
              onclick={() => resizeBy(axis.key, -1)}
              disabled={!bounds || item[axis.key] <= bounds.min[axis.key]}
            >
              −
            </Button>
            <span class="w-4 text-center tabular-nums">{item[axis.key]}</span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Increase {axis.label.toLowerCase()}"
              onclick={() => resizeBy(axis.key, 1)}
              disabled={!bounds || item[axis.key] >= bounds.max[axis.key]}
            >
              +
            </Button>
          </div>
        </div>
      {/each}
    </div>
  </div>
  {#if control.type === 'mixer'}
    <section class="grid gap-3">
      <h3 class="section-label">Colour</h3>
      <ColorField
        value={control.variants[0]?.color ?? '#b5a0e8'}
        onchange={(color) => (control.variants[0].color = color)}
      />
    </section>
    <section class="grid gap-3">
      <h3 class="section-label">Channels</h3>
      <MixerEditor controlId={control.id} />
    </section>
  {:else if control.type === 'media'}
    <MediaEditor {control} />
    {@render scenarioSection()}
  {:else if control.type === 'web'}
    <WebEditor {control} />
    {@render scenarioSection()}
  {:else}
    <VariantList {control} />
    {@render scenarioSection()}
  {/if}
</div>

<script lang="ts">
  import type { Component } from 'svelte';
  import type { ControlFaceProps } from '../core/controls';
  import { effectiveSize, layoutFor, setLayoutItems, type LayoutTarget } from '../core/skin-layouts';
  import { skinFaceFor } from '../core/skins';
  import { controlTypes } from '../core/registry';
  import { settings } from '../core/settings.svelte';
  import DeckGrid from '../controls/DeckGrid.svelte';
  import { getSkinHostContext } from './context';

  let { id, editing = false, selected = null, onselect, oncontext }:
    { id: string; editing?: boolean; selected?: import('../core/layout').Selection;
      onselect?: (selection: import('../core/layout').Selection, target?: LayoutTarget) => void;
      oncontext?: (selection: Exclude<import('../core/layout').Selection, null>, x: number, y: number, target?: LayoutTarget) => void } = $props();
  const host = getSkinHostContext();
  const target = $derived(host && { skinId: host.skin.id, pageId: host.page.id, slotId: id });
  const slot = $derived(host?.skin.slots.find(entry => entry.id === id));
  const layout = $derived(host && target ? layoutFor(settings, target.skinId, target.pageId, target.slotId) : undefined);
  const geometry = $derived(layout?.geometry && ({ ...layout.geometry, items: layout.items }));
  const faceMap = $derived.by(() => {
    const result: Record<string, Component<ControlFaceProps>> = {};
    for (const type of Object.keys(host?.skin.controlSkins ?? {})) {
      const control = controlTypes.get(type);
      const face = host && control ? skinFaceFor(host.skin, type, control.face) : undefined;
      if (face) result[type] = face;
    }
    return result;
  });
  let width = $state(0), height = $state(0);
  const isEditing = $derived(editing || host?.mode === 'editor');
  function resolveSize(typeId: string) {
    return host && slot ? effectiveSize(host.skin.id, slot, typeId) : undefined;
  }
  function writeItems(items: import('../core/layout').Item[]) {
    return target ? setLayoutItems(settings, target, items) : false;
  }
</script>

{#if host && slot && layout && geometry}
  <div bind:clientWidth={width} bind:clientHeight={height} data-skin-slot={id}
    class="relative grid h-full w-full place-items-center">
    <DeckGrid page={host.page} layout={geometry} {target} {faceMap} compact={slot.kind === 'strip'}
      availableWidth={width} availableHeight={height} pageRenderVisible={host.pageRenderVisible}
      resolvePresentation={host.resolvePresentation} editing={isEditing} {selected} {onselect} {oncontext}
      {resolveSize} onitemschange={writeItems} />
  </div>
{:else}
  <div role="status" aria-label="Skin slot unavailable" class="grid h-full w-full place-items-center rounded-lg border border-destructive/40 text-xs text-destructive">
    Unavailable
  </div>
{/if}

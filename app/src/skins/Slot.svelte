<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
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
  const activeInView = $derived(host?.skin.views.find(view => view.id === host.viewId)?.slots.includes(id) ?? false);
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
  let reducedMotion = $state(false);
  const isEditing = $derived(editing || host?.mode === 'editor');
  onMount(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = query.matches;
    const change = () => { reducedMotion = query.matches; };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  });
  function resolveSize(typeId: string) {
    return host && slot ? effectiveSize(host.skin.id, slot, typeId) : undefined;
  }
  function writeItems(items: import('../core/layout').Item[]) {
    return target ? setLayoutItems(settings, target, items) : false;
  }
</script>

{#if host && slot && layout && geometry}
  <div bind:clientWidth={width} bind:clientHeight={height} data-skin-slot={id}
    data-skin-input={host.skin.design && activeInView ? 'slot' : undefined} aria-hidden={!activeInView} inert={!activeInView}
    class="relative grid h-full w-full place-items-center transition-opacity duration-150 motion-reduce:transition-none"
    class:opacity-0={!activeInView} class:pointer-events-none={!activeInView}>
    {#if activeInView}
      <div class="absolute inset-0 grid place-items-center" transition:fade={{ duration: reducedMotion ? 0 : 150 }}>
        <DeckGrid page={host.page} layout={geometry} {target} {faceMap} compact={slot.kind === 'strip'}
          availableWidth={width} availableHeight={height} pageRenderVisible={host.pageRenderVisible && activeInView}
          resolvePresentation={host.resolvePresentation} editing={isEditing} {selected} {onselect} {oncontext}
          {resolveSize} onitemschange={writeItems} />
      </div>
    {/if}
  </div>
{:else if host && slot && activeInView}
  <div role="status" aria-label="Skin slot unavailable" class="grid h-full w-full place-items-center rounded-lg border border-destructive/40 text-xs text-destructive">
    Unavailable
  </div>
{/if}

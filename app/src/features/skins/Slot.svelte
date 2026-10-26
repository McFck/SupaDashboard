<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { Component } from 'svelte';
  import type { ControlFaceProps } from '../controls/model';
  import {
    effectiveSize,
    layoutFor,
    setLayoutItems,
    type LayoutTarget,
  } from '../layout/skin-layouts';
  import { skinFaceFor } from './definition';
  import { controlTypes } from '../plugins/registry';
  import { settings } from '../settings/state.svelte';
  import DeckGrid from '../layout/ui/DeckGrid.svelte';
  import { getSkinHostContext } from './context';

  let {
    id,
    editing = false,
    selected,
    onselect,
    oncontext,
  }: {
    id: string;
    editing?: boolean;
    selected?: import('../layout/grid').Selection;
    onselect?: (selection: import('../layout/grid').Selection, target?: LayoutTarget) => void;
    oncontext?: (
      selection: Exclude<import('../layout/grid').Selection, null>,
      x: number,
      y: number,
      target?: LayoutTarget,
    ) => void;
  } = $props();
  const host = getSkinHostContext();
  const target = $derived(host && { skinId: host.skin.id, pageId: host.page.id, slotId: id });
  const slot = $derived(host?.skin.slots.find((entry) => entry.id === id));
  const activeInView = $derived(
    host?.skin.views.find((view) => view.id === host.viewId)?.slots.includes(id) ?? false,
  );
  const layout = $derived(
    host && target ? layoutFor(settings, target.skinId, target.pageId, target.slotId) : undefined,
  );
  const geometry = $derived(layout?.geometry && { ...layout.geometry, items: layout.items });
  const faceMap = $derived.by(() => {
    const result: Record<string, Component<ControlFaceProps>> = {};
    for (const type of Object.keys(host?.skin.controlSkins ?? {})) {
      const control = controlTypes.get(type);
      const face = host && control ? skinFaceFor(host.skin, type, control.face) : undefined;
      if (face) result[type] = face;
    }
    return result;
  });
  let width = $state(0),
    height = $state(0);
  let reducedMotion = $state(false);
  const isEditing = $derived(editing || host?.mode === 'editor');
  onMount(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = query.matches;
    const change = () => {
      reducedMotion = query.matches;
    };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  });
  function resolveSize(typeId: string) {
    return host && slot ? effectiveSize(host.skin.id, slot, typeId) : undefined;
  }
  function writeItems(items: import('../layout/grid').Item[]) {
    return target ? setLayoutItems(settings, target, items) : false;
  }
  const selectedValue = $derived(selected === undefined ? (host?.selected ?? null) : selected);
  function selectSlot(selection: import('../layout/grid').Selection) {
    if (onselect) onselect(selection, target);
    else host?.onselect?.(selection, target);
  }
  function contextSlot(
    selection: Exclude<import('../layout/grid').Selection, null>,
    x: number,
    y: number,
  ) {
    if (oncontext) oncontext(selection, x, y, target);
    else host?.oncontext?.(selection, x, y, target);
  }
</script>

{#if host && slot && layout && geometry}
  <div
    bind:clientWidth={width}
    bind:clientHeight={height}
    data-skin-slot={id}
    data-skin-input={host.mode === 'runtime' && host.skin.design && activeInView
      ? 'slot'
      : undefined}
    aria-hidden={!activeInView}
    inert={!activeInView}
    class="relative grid h-full w-full place-items-center transition-opacity duration-150 motion-reduce:transition-none"
    class:opacity-0={!activeInView}
    class:pointer-events-none={!activeInView}
    class:skin-editor-slot={host.mode === 'editor' && host.skin.id !== 'deck'}
  >
    {#if activeInView}
      <div
        class="absolute inset-0 grid place-items-center"
        transition:fade={{ duration: reducedMotion ? 0 : 150 }}
      >
        <DeckGrid
          page={host.page}
          layout={geometry}
          {target}
          {faceMap}
          compact={slot.kind === 'strip'}
          availableWidth={width}
          availableHeight={height}
          pageRenderVisible={host.pageRenderVisible && activeInView}
          resolvePresentation={host.resolvePresentation}
          editorPreview={host.mode === 'editor'}
          editing={isEditing}
          selected={selectedValue}
          onselect={selectSlot}
          oncontext={contextSlot}
          {resolveSize}
          onitemschange={writeItems}
        />
      </div>
      {#if host.mode === 'editor' && host.skin.id !== 'deck'}
        <span
          aria-hidden="true"
          class="pointer-events-none absolute left-1 top-1 z-[70] rounded bg-background/90 px-1.5 py-0.5 text-[24px] font-medium text-foreground"
          >{slot.id}</span
        >
      {/if}
    {/if}
  </div>
{:else if host && slot && activeInView}
  <div
    role="status"
    aria-label="Skin slot unavailable"
    class="grid h-full w-full place-items-center rounded-lg border border-destructive/40 text-xs text-destructive"
  >
    Unavailable
  </div>
{/if}

<style>
  .skin-editor-slot {
    outline: 2px dashed #a6d7c3;
    outline-offset: 2px;
    overflow: visible;
  }
</style>

<script lang="ts">
  import type { Component } from 'svelte';
  import type { ControlFaceProps } from '../controls/model';
  import {
    effectiveSize,
    layoutFor,
    setLayoutItems,
    type LayoutTarget,
  } from '../layout/applet-layouts';
  import { controlTypes } from '../plugins/registry';
  import { settings } from '../settings/state.svelte';
  import DeckGrid from '../layout/ui/DeckGrid.svelte';
  import { getAppletHostContext } from './context';

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
  const host = getAppletHostContext();
  const target = $derived(host && { appletId: host.applet.id, pageId: host.page.id, slotId: id });
  const slot = $derived(host?.applet.slots.find((entry) => entry.id === id));
  const layout = $derived(
    host && target ? layoutFor(settings, target.appletId, target.pageId, target.slotId) : undefined,
  );
  const geometry = $derived(layout?.geometry && { ...layout.geometry, items: layout.items });
  const faceMap = $derived.by(() => {
    const result: Record<string, Component<ControlFaceProps>> = {};
    for (const type of Object.keys(host?.applet.controlFaces ?? {})) {
      const defaultFace = controlTypes.get(type)?.face;
      if (host && defaultFace) {
        result[type] = host.applet.controlFaces?.[type]?.component ?? defaultFace;
      }
    }
    return result;
  });
  let width = $state(0),
    height = $state(0);
  const isEditing = $derived(editing || host?.mode === 'editor');
  function resolveSize(typeId: string) {
    return host && slot ? effectiveSize(host.applet.id, slot, typeId) : undefined;
  }
  function writeItems(items: import('../layout/grid').Item[]) {
    return target ? setLayoutItems(settings, target, items) : false;
  }
  const selectedValue = $derived(selected === undefined ? (host?.selected ?? null) : selected);
  function selectSlot(selection: import('../layout/grid').Selection) {
    if (onselect) {
      onselect(selection, target);
    } else {
      host?.onselect?.(selection, target);
    }
  }
  function contextSlot(
    selection: Exclude<import('../layout/grid').Selection, null>,
    x: number,
    y: number,
  ) {
    if (oncontext) {
      oncontext(selection, x, y, target);
    } else {
      host?.oncontext?.(selection, x, y, target);
    }
  }
</script>

{#if host && slot && layout && geometry}
  <div
    bind:clientWidth={width}
    bind:clientHeight={height}
    data-applet-slot={id}
    data-applet-input={host.mode === 'runtime' && host.applet.design ? 'slot' : undefined}
    class="relative grid h-full w-full place-items-center"
  >
    <div class="absolute inset-0 grid place-items-center">
      <DeckGrid
        page={host.page}
        layout={geometry}
        {target}
        {faceMap}
        compact={slot.kind === 'strip'}
        availableWidth={width}
        availableHeight={height}
        pageRenderVisible={host.pageRenderVisible}
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
  </div>
{:else if host && slot}
  <div
    role="status"
    aria-label="Applet slot unavailable"
    class="grid h-full w-full place-items-center rounded-lg border border-destructive/40 text-xs text-destructive"
  >
    Unavailable
  </div>
{/if}

<script lang="ts">
  // Right-hand panel of the layout editor. Everything edits the live settings, so the dashboard updates as you type.
  import { onDestroy } from 'svelte';
  import { prefersReducedMotion as reducedMotion } from 'svelte/motion';
  import Copy from '@lucide/svelte/icons/copy';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Separator } from '$lib/components/ui/separator';
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';
  import Icon from '../controls/Icon.svelte';
  import { moveVariant, removeVariant as removeStateVariant, SPRING_SAMPLES, springDuration, type ControlConfig, type Variant } from '../core/controls';
  import type { Trigger } from '../core/scenario';
  import { clampToGrid, firstFree, fits, placementForType, type Selection } from '../core/layout';
  import { controlTypes } from '../core/registry';
  import { controlById, newId, settings } from '../core/settings.svelte';
  import { newScenarioId, normalizeControl } from '../core/scenario';
  import { commit } from '../core/history.svelte';
  import { toast } from 'svelte-sonner';
  import { cloneControl } from './ui/layout-actions';
  import { animateRemoval } from '../controls/removal';
  import ColorField from '../editor/ColorField.svelte';
  import IconPicker from '../editor/IconPicker.svelte';
  import ValueEditor from '../editor/ValueEditor.svelte';
  import GestureEditor from './GestureEditor.svelte';
  import MixerEditor from './MixerEditor.svelte';
  import { buildExistingControlRows, searchExistingControls } from './ui/existing-controls';
  import PluginMark, { pluginTitle } from '../editor/PluginMark.svelte';
  import Row from './ui/Row.svelte';
  import Section from './ui/Section.svelte';

  let { selection, onselect, oneditScenario }: { selection: Selection; onselect: (s: Selection) => void;
    oneditScenario: (controlId: string, itemId: string, trigger?: Trigger) => void } = $props();

  const item = $derived(selection && 'item' in selection ? settings.deck.items.find(i => i.id === selection.item) : undefined);
  const control = $derived(item ? controlById(item.control) : undefined);
  const def = $derived(control ? controlTypes.get(control.type) : undefined);
  const cell = $derived(selection && 'cell' in selection ? selection.cell : undefined);
  let existingOpen = $state(true);
  let existingQuery = $state('');
  const existingRows = $derived(buildExistingControlRows(settings.controls, settings.deck.items, controlTypes).filter(row => row.uses > 0));
  const filteredExistingRows = $derived(searchExistingControls(existingRows, existingQuery));

  function placement(w: number, h: number) {
    const at = cell && fits(settings.deck.items, { ...cell, w, h }, settings.deck) ? cell : firstFree(settings.deck.items, w, h, settings.deck);
    if (!at) {
      toast.error('No free space for this widget');
      return null;
    }
    return at;
  }
  function placeExisting(controlId: string) {
    const existing = settings.controls.find(c => c.id === controlId);
    const type = existing && controlTypes.get(existing.type);
    if (!existing || !type) return;
    const at = placementForType(settings.deck.items, settings.deck, type, cell);
    if (!at) {
      toast.error('No free space for this widget');
      return;
    }
    // An independent copy: each placed widget keeps its own state.
    const copy = { ...cloneControl($state.snapshot(existing) as ControlConfig), id: newId(existing.id, settings.controls.map(c => c.id)) };
    const id = newId('i', settings.deck.items.map(i => i.id));
    commit('Add widget');
    settings.controls.push(copy);
    settings.deck.items.push({ id, control: copy.id, ...at });
    onselect({ item: id });
  }
  function addNew(type: string) {
    const t = controlTypes.get(type);
    if (!t) return;
    const at = placementForType(settings.deck.items, settings.deck, t, cell);
    if (!at) {
      toast.error('No free space for this widget');
      return;
    }
    const c = normalizeControl({ id: newId(t.title, settings.controls.map(x => x.id)), type, ...structuredClone(t.create()) });
    const id = newId('i', settings.deck.items.map(i => i.id));
    commit(`Add ${t.title}`);
    settings.controls.push(c);
    settings.deck.items.push({ id, control: c.id, ...at });
    onselect({ item: id });
  }
  function duplicate() {
    if (!control || !item) return;
    const at = placement(item.w, item.h);
    if (!at) return;
    const copy = { ...structuredClone($state.snapshot(control)), id: newId(control.name, settings.controls.map(x => x.id)), name: `${control.name} copy` };
    const id = newId('i', settings.deck.items.map(i => i.id));
    commit(`Duplicate ${control.name}`);
    settings.controls.push(copy as ControlConfig);
    settings.deck.items.push({ id, control: copy.id, ...at, w: item.w, h: item.h });
    onselect({ item: id });
  }
  async function removeItem() {
    if (!item) return;
    const removing = { ...item }, name = control?.name ?? 'widget';
    await animateRemoval(removing.id);
    if (!settings.deck.items.some(i => i.id === removing.id)) return;
    commit(`Delete ${name}`);
    settings.deck.items = settings.deck.items.filter(i => i.id !== removing.id);
    if (!settings.deck.items.some(i => i.control === removing.control)) {
      settings.controls = settings.controls.filter(c => c.id !== removing.control);
      delete settings.variants[removing.control];
    }
    if (selection && 'item' in selection && selection.item === removing.id) onselect(null);
  }
  function resize(w: number, h: number) {
    if (w < (def?.minSize?.w ?? 1) || h < (def?.minSize?.h ?? 1) ||
      w > (def?.maxSize?.w ?? 99) || h > (def?.maxSize?.h ?? 99)) return;
    if (!item || !fits(settings.deck.items, { x: item.x, y: item.y, w, h }, settings.deck, [item.id])) return;
    settings.deck.items = settings.deck.items.map(current => current.id === item.id ? { ...current, w, h } : current);
  }
  function setGrid(key: 'rows' | 'cols' | 'size' | 'gap', v: number) {
    settings.deck[key] = v;
  }
  // Items outside a shrunk grid are only hidden while the slider is held; releasing it removes them.
  function commitGrid(key: 'rows' | 'cols' | 'size' | 'gap') {
    if (key === 'rows' || key === 'cols') settings.deck.items = clampToGrid(settings.deck.items, settings.deck);
  }
  function setSizing(auto: boolean) {
    const sizing = auto ? 'auto' : 'manual';
    if (settings.deck.sizing === sizing) return;
    commit('Deck sizing');
    settings.deck.sizing = sizing;
  }
  const addVariant = () => control!.variants.push({ ...structuredClone($state.snapshot(control!.variants.at(-1)!)),
    id: newScenarioId(), label: '' } as Variant);
  type VariantDrag = {
    controlId: string;
    variantId: string;
    pointerId: number;
    originalOrder: string[];
    sourceIndex: number;
    startClientY: number;
    latestClientY: number;
    startScrollTop: number;
    sourceCenter: number;
    listTop: number;
    rowCenters: number[];
    rowBounds: { top: number; bottom: number }[];
    cards: HTMLElement[];
    sourceNode: HTMLElement;
    handle: HTMLButtonElement;
    destination: number;
    moved: boolean;
    raf: number | null;
  };
  let draggingVariant = $state<string | null>(null);
  let variantList = $state<HTMLElement>();
  let inspectorScroll = $state<HTMLElement>();
  let skipVariantFlip = false;
  const VARIANT_GAP = 12;
  let variantDrag = $state<VariantDrag | null>(null);
  function variantId(variant: Variant, index: number) { return variant.id ?? `state-${index + 1}`; }
  function reorderVariant(from: number, to: number, label?: string) {
    if (!control) return;
    if (label) commit(label);
    settings.variants[control.id] = moveVariant(control, settings.variants[control.id] ?? 0, from, to);
  }
  function variantOrderMatches(drag: VariantDrag) {
    const current = control;
    return !!current && current.id === drag.controlId && current.variants.length === drag.originalOrder.length &&
      current.variants.every((variant, index) => variantId(variant, index) === drag.originalOrder[index]);
  }
  function cancelVariantDrag() {
    const current = variantDrag;
    if (!current) return;
    if (current.raf !== null) cancelAnimationFrame(current.raf);
    for (const card of current.cards) { card.style.transition = 'none'; card.style.removeProperty('transform'); }
    requestAnimationFrame(() => { for (const card of current.cards) card.style.removeProperty('transition'); });
    variantDrag = null;
    draggingVariant = null;
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
  }
  function cancelVariantPointer(event: PointerEvent) {
    if (variantDrag?.pointerId === event.pointerId) cancelVariantDrag();
  }
  function paintVariantDrag(current: VariantDrag) {
    if (!variantOrderMatches(current)) { cancelVariantDrag(); return; }
    const scrollTop = inspectorScroll?.scrollTop ?? current.startScrollTop;
    const scrollDelta = scrollTop - current.startScrollTop;
    const pointerDelta = current.latestClientY - current.startClientY;
    current.moved ||= Math.abs(pointerDelta) >= 4 || Math.abs(scrollDelta) >= 4;
    if (!current.moved) return;
    const bounds = current.rowBounds, source = bounds[current.sourceIndex];
    // Keep the card inside the list, and slide its neighbours out of the way as soon as it passes their middle.
    const translation = Math.max(bounds[0].top - source.top, Math.min(bounds.at(-1)!.bottom - source.bottom, pointerDelta + scrollDelta));
    // Swap as soon as the card's leading edge passes a neighbour's middle.
    const i = current.sourceIndex;
    current.destination = translation > 0
      ? i + current.rowCenters.filter((center, k) => k > i && center < source.bottom + translation).length
      : i - current.rowCenters.filter((center, k) => k < i && center > source.top + translation).length;
    current.sourceNode.style.transition = 'none';
    current.sourceNode.style.transform = `translateY(${translation}px)`;
    const step = source.bottom - source.top + VARIANT_GAP;
    current.cards.forEach((card, k) => {
      if (k === current.sourceIndex) return;
      const shift = k > current.sourceIndex && k <= current.destination ? -step : k < current.sourceIndex && k >= current.destination ? step : 0;
      card.style.transform = shift ? `translateY(${shift}px)` : '';
    });
    draggingVariant = current.variantId;
  }
  function moveVariantDrag(event: PointerEvent) {
    const current = variantDrag;
    if (!current || current.pointerId !== event.pointerId) return;
    current.latestClientY = event.clientY;
    if (current.raf !== null) return;
    current.raf = requestAnimationFrame(() => {
      current.raf = null;
      if (variantDrag === current) paintVariantDrag(current);
    });
  }
  function beginVariantDrag(event: PointerEvent, variant: Variant, index: number) {
    if (event.button !== 0 || !control || !variantList || !inspectorScroll) return;
    const handle = event.currentTarget as HTMLButtonElement;
    const scroll = inspectorScroll;
    const cards = [...variantList.querySelectorAll<HTMLElement>('[data-variant-card]')];
    const rowBounds = cards.map(card => {
      const rect = card.getBoundingClientRect();
      return { top: rect.top + scroll.scrollTop, bottom: rect.bottom + scroll.scrollTop };
    });
    const sourceId = variantId(variant, index);
    const sourceNode = cards.find(card => card.dataset.variantId === sourceId);
    const sourceRect = sourceNode?.getBoundingClientRect();
    if (!sourceNode || !sourceRect || cards.length !== control.variants.length) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const scrollTop = scroll.scrollTop;
    variantDrag = {
      controlId: control.id,
      variantId: sourceId,
      pointerId: event.pointerId,
      originalOrder: control.variants.map(variantId),
      sourceIndex: index,
      startClientY: event.clientY,
      latestClientY: event.clientY,
      startScrollTop: scrollTop,
      sourceCenter: sourceRect.top + scrollTop + sourceRect.height / 2,
      listTop: rowBounds[0].top,
      rowCenters: rowBounds.map(row => (row.top + row.bottom) / 2),
      rowBounds,
      cards,
      sourceNode,
      handle,
      destination: index,
      moved: false,
      raf: null,
    };
  }
  function finishVariantDrag(event: PointerEvent) {
    const current = variantDrag;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.raf !== null) cancelAnimationFrame(current.raf);
    current.raf = null;
    current.latestClientY = event.clientY;
    paintVariantDrag(current);
    const shouldReorder = variantOrderMatches(current) && current.moved && current.destination !== current.sourceIndex;
    const from = current.sourceIndex, to = current.destination;
    // Neighbours already sit in their final slots, so this commit must not FLIP them again.
    skipVariantFlip = shouldReorder;
    cancelVariantDrag();
    if (shouldReorder) reorderVariant(from, to, 'Reorder variants');
    setTimeout(() => { skipVariantFlip = false; }, 50);
  }
  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !variantDrag) return;
    event.preventDefault();
    cancelVariantDrag();
  }
  $effect(() => {
    const current = variantDrag;
    if (current && !variantOrderMatches(current)) cancelVariantDrag();
  });
  onDestroy(cancelVariantDrag);
  function springProgressAt(time: number) {
    const position = Math.max(0, Math.min(1, time)) * (SPRING_SAMPLES.length - 1);
    const index = Math.min(SPRING_SAMPLES.length - 2, Math.floor(position));
    const fraction = position - index;
    const from = SPRING_SAMPLES[index].progress, to = SPRING_SAMPLES[index + 1].progress;
    return from + (to - from) * fraction;
  }
  function variantFlip(_node: Element, { from, to }: { from: DOMRect; to: DOMRect }) {
    const offset = from.top - to.top;
    return { duration: reducedMotion.current || skipVariantFlip || !offset ? 0 : springDuration(Math.abs(offset)),
      css: (time: number) => `transform: translateY(${offset * (1 - springProgressAt(time))}px)` };
  }
  function removeVariant(index: number) {
    if (!control || control.variants.length < 2) return;
    settings.variants[control.id] = removeStateVariant(control, settings.variants[control.id] ?? 0, index);
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} onblur={cancelVariantDrag} />
<aside class="flex h-full w-full min-w-0 flex-col bg-sidebar">
  {#if control && item && def}
    <header class="flex h-16 shrink-0 items-center gap-3 border-b px-4">
      <span class="grid size-10 place-items-center rounded-xl bg-white/5" style:color={control.variants[settings.variants[control.id] ?? 0]?.color}><Icon name={def.icon} size={20} /></span>
      <p class="flex-1 font-semibold">{def.title}</p>
      <Button size="icon" variant="ghost" aria-label="Duplicate" onclick={duplicate}><Copy /></Button>
      <Button size="icon" variant="ghost" aria-label="Remove" onclick={removeItem}><Trash /></Button>
    </header>
    <div bind:this={inspectorScroll} class="grid min-h-0 min-w-0 flex-1 content-start gap-5 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]">
      <div class="grid gap-1.5"><Label class="text-xs font-semibold uppercase tracking-wide text-muted-foreground" for="wname">Name</Label><Input id="wname" bind:value={control.name} /></div>
      <div class="grid gap-1.5">
        <Label class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Size</Label>
        <div class="grid grid-cols-2 gap-3 text-sm">
          {#each [['w', 'Width'], ['h', 'Height']] as [k, label] (k)}
            <div class="grid gap-2">
              <span class="text-xs text-muted-foreground">{label}</span>
              <div class="flex items-center gap-2">
                <Button size="icon-sm" variant="outline" aria-label="Decrease {label.toLowerCase()}" onclick={() => resize(k === 'w' ? item.w - 1 : item.w, k === 'h' ? item.h - 1 : item.h)}
                  disabled={(k === 'w' ? item.w : item.h) <= ((k === 'w' ? def.minSize?.w : def.minSize?.h) ?? 1)}>−</Button>
                <span class="w-4 text-center tabular-nums">{k === 'w' ? item.w : item.h}</span>
                <Button size="icon-sm" variant="outline" aria-label="Increase {label.toLowerCase()}" onclick={() => resize(k === 'w' ? item.w + 1 : item.w, k === 'h' ? item.h + 1 : item.h)}
                  disabled={(k === 'w' ? item.w : item.h) >= ((k === 'w' ? def.maxSize?.w : def.maxSize?.h) ?? 99)}>+</Button>
              </div>
            </div>
          {/each}
        </div>
      </div>
      <Separator />
      {#if control.type === 'mixer'}
        <section class="grid gap-3">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Colour</h3>
          <ColorField value={control.variants[0]?.color ?? '#b5a0e8'} onchange={c => control.variants[0].color = c} />
        </section>
        <section class="grid gap-3"><h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Channels</h3><MixerEditor controlId={control.id} /></section>
      {:else}
        <section class="grid gap-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Variants</h3>
            <Button variant="ghost" size="sm" onclick={addVariant}><Plus /> Add</Button>
          </div>
          <div bind:this={variantList} class="relative grid gap-3">
          {#each control.variants as variant, i (variantId(variant, i))}
            <div data-variant-card data-variant-id={variantId(variant, i)} animate:variantFlip
              class="relative grid min-w-0 gap-3 rounded-xl border bg-card p-3 transition-[transform,box-shadow] duration-200 ease-out {draggingVariant === variantId(variant, i) ? 'z-10 shadow-lg ring-1 ring-white/15' : ''}">
              <div class="flex items-end gap-2">
                {#if control.variants.length > 1}
                  <button type="button" aria-label="Reorder variant" class="mb-2 grid h-6 w-4 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing"
                    onpointerdown={e => beginVariantDrag(e, variant, i)} onpointermove={moveVariantDrag} onpointerup={finishVariantDrag}
                    onpointercancel={cancelVariantPointer} onlostpointercapture={cancelVariantPointer}
                    onkeydown={e => { const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1; if (to < 0 || to >= control.variants.length) return; e.preventDefault(); reorderVariant(i, to, 'Reorder variants'); }}><GripVertical class="size-4" /></button>
                {/if}
                <IconPicker value={variant.icon ?? undefined} onchange={n => (variant.icon = n)} />
                <div class="grid min-w-0 flex-1 gap-1"><Label class="text-[11px] text-muted-foreground">Label</Label><Input bind:value={variant.label} /></div>
                <Button variant="ghost" size="icon" aria-label="Remove variant" disabled={control.variants.length === 1}
                  onclick={() => removeVariant(i)}><Trash /></Button>
              </div>
              <div class="grid gap-2">
                <div class="flex items-center justify-between">
                  <Label class="text-xs text-muted-foreground">Colour</Label>
                  
                </div>
                <ColorField value={variant.color ?? '#8ea8f0'} onchange={c => variant.color = c} />
              </div>
              {#if control.type === 'slider'}
                <ValueEditor value={variant.value ?? { id: 'volume' }} onchange={v => (variant.value = v)} />
              {/if}
            </div>
          {/each}
          </div>
        </section>
        <Separator />
        <section class="grid gap-3">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scenario</h3>
          <GestureEditor {control} onedit={trigger => oneditScenario(control.id, item.id, trigger)} />
        </section>
      {/if}
    </div>

  {:else if cell}
    <header class="flex h-16 shrink-0 items-center border-b px-4"><p class="font-semibold">Add widget</p></header>
    <div class="grid min-h-0 min-w-0 flex-1 content-start gap-2 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]">
      {#each [...controlTypes.values()] as t (t.type)}
        {@const fit = placementForType(settings.deck.items, settings.deck, t, cell)}
        <button type="button" aria-disabled={!fit} onclick={() => addNew(t.type)}
          class:opacity-45={!fit}
          class="flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.02] p-3 text-left transition hover:border-white/20 hover:bg-white/[.05]">
          <span class="grid size-10 place-items-center rounded-lg bg-white/5"><Icon name={t.icon} size={20} /></span>
          <span class="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium"><span class="min-w-0 truncate">{t.title}</span><PluginMark plugin={t.plugin} /></span>
          <span class="text-xs tabular-nums text-muted-foreground">{fit?.w ?? t.size.w}×{fit?.h ?? t.size.h}</span>
        </button>
      {/each}
      {#if existingRows.length}
      <details bind:open={existingOpen} class="mt-3 min-w-0">
        <summary class="flex cursor-pointer list-none items-center gap-2 rounded-md py-2 text-xs font-semibold text-muted-foreground outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
          <ChevronDown class="size-4 shrink-0 transition-transform motion-reduce:transition-none {existingOpen ? 'rotate-180' : ''}" />
          <span class="flex-1">Existing</span>
          <span class="tabular-nums">{existingRows.length}</span>
        </summary>
        <div class="grid min-w-0 gap-2 pt-2">
          <Input aria-label="Search existing controls" placeholder="Search controls" bind:value={existingQuery} />
          <div class="grid min-h-0 max-h-[min(360px,45dvh)] gap-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
            {#if filteredExistingRows.length}
              {#each filteredExistingRows as row (row.id)}
                {@const type = controlTypes.get(row.typeId)}
                {@const providerTitle = pluginTitle(type?.plugin)}
                {@const fit = type ? placementForType(settings.deck.items, settings.deck, type, cell) : null}
                <button type="button" disabled={!row.available} aria-disabled={!fit || !row.available}
                  aria-label="{row.name}, {row.typeTitle}{providerTitle ? `, Plugin: ${providerTitle}` : ''}, {row.uses} {row.uses === 1 ? 'use' : 'uses'}{row.available ? '' : ', unavailable'}{fit ? '' : ', no free space'}"
                  onclick={() => placeExisting(row.id)}
                  class:opacity-45={!fit}
                  class="flex min-w-0 items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left outline-none transition-colors hover:border-white/10 hover:bg-white/[.04] focus-visible:border-white/20 focus-visible:bg-white/[.05] disabled:pointer-events-none disabled:opacity-45">
                  <span class="grid size-8 shrink-0 place-items-center rounded-md bg-white/5"><Icon name={row.icon} size={18} /></span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{row.name}</span>
                    <span class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"><span class="min-w-0 truncate">{row.typeTitle}</span><PluginMark plugin={type?.plugin} /></span>
                  </span>
                  <span class="shrink-0 text-xs tabular-nums text-muted-foreground" aria-label="Used in {row.uses} deck items">{row.uses} {row.uses === 1 ? 'use' : 'uses'}</span>
                </button>
              {/each}
            {:else}
              <p class="py-3 text-center text-sm text-muted-foreground">No results</p>
            {/if}
          </div>
        </div>
      </details>
      {/if}
    </div>

  {:else}
    <header class="flex h-16 shrink-0 items-center border-b px-4"><p class="font-semibold">Deck</p></header>
    <div class="grid min-h-0 min-w-0 flex-1 content-start gap-6 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]">
      <Section>
        <Row label="Auto fit" for="auto-fit"><Switch id="auto-fit" checked={settings.deck.sizing === 'auto'} onCheckedChange={setSizing} /></Row>
      </Section>
      <div class="grid gap-6">
      {#each [{ k: 'rows', label: 'Rows', min: 1, max: 8 }, { k: 'cols', label: 'Columns', min: 1, max: 14 },
        ...(settings.deck.sizing === 'manual' ? [{ k: 'size', label: 'Cell size', min: 60, max: 240, unit: 'px' }] : []),
        { k: 'gap', label: 'Gap', min: 0, max: 40, unit: 'px' }] as s (s.k)}
        {@const key = s.k as 'rows' | 'cols' | 'size' | 'gap'}
        <div class="grid gap-3">
          <div class="flex justify-between text-sm"><Label>{s.label}</Label><span class="tabular-nums text-muted-foreground">{settings.deck[key]}{s.unit ?? ''}</span></div>
          <Slider type="single" value={settings.deck[key]} min={s.min} max={s.max} step={1} onValueChange={v => setGrid(key, v)} onValueCommit={() => commitGrid(key)} />
        </div>
      {/each}
      </div>
    </div>
  {/if}
</aside>

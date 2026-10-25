<script lang="ts">
  // Right-hand panel of the layout editor. Everything edits the live settings, so the dashboard updates as you type.
  import { prefersReducedMotion as reducedMotion } from 'svelte/motion';
  import Copy from '@lucide/svelte/icons/copy';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import { sortable } from '$lib/sortable';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Separator } from '$lib/components/ui/separator';
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';
  import Icon from '../controls/Icon.svelte';
  import { MAX_VARIANTS, moveVariant, removeVariant as removeStateVariant, SPRING_SAMPLES, springDuration, type ControlConfig, type Variant } from '../core/controls';
  import type { Trigger } from '../core/scenario';
  import { clampToGrid, firstFree, fits, type Selection } from '../core/layout';
  import { controlTypes } from '../core/registry';
  import { controlById, newId, settings, type Page } from '../core/settings.svelte';
  import { pageItems, removePlacement } from '../core/pages';
  import { allPlacements, canSetLayoutItems, effectiveSize, layoutFor, setLayoutItems, type LayoutTarget } from '../core/skin-layouts';
  import { newScenarioId, normalizeControl } from '../core/scenario';
  import { commit } from '../core/history.svelte';
  import { toast } from 'svelte-sonner';
  import { splitAlpha, withAlpha } from '../core/palette';
  import { cloneControl } from './ui/layout-actions';
  import { animateRemoval } from '../controls/removal';
  import ColorField from '../editor/ColorField.svelte';
  import IconPicker from '../editor/IconPicker.svelte';
  import ValueEditor from '../editor/ValueEditor.svelte';
  import GestureEditor from './GestureEditor.svelte';
  import MixerEditor from './MixerEditor.svelte';
  import MediaEditor from './MediaEditor.svelte';
  import WebEditor from './WebEditor.svelte';
  import { buildExistingControlRows, searchExistingControls } from './ui/existing-controls';
  import PluginMark, { pluginTitle } from '../editor/PluginMark.svelte';
  import Row from './ui/Row.svelte';
  import Section from './ui/Section.svelte';

  let { selection, onselect, oneditScenario, onclose, page, layoutTarget }: { selection: Selection; onselect: (s: Selection, target?: LayoutTarget) => void;
    oneditScenario: (controlId: string, itemId: string, trigger?: Trigger) => void; onclose: () => void; page: Page; layoutTarget: LayoutTarget } = $props();

  const allItems = $derived(pageItems(settings.deck.pages, settings.skinLayouts));
  const targetLayout = $derived(layoutFor(settings, layoutTarget.skinId, layoutTarget.pageId, layoutTarget.slotId));
  const targetItems = $derived(targetLayout?.items ?? []);
  const targetGeometry = $derived(targetLayout?.geometry ?? page);
  const targetSlot = $derived(targetLayout?.slot);
  const item = $derived(selection && 'item' in selection ? targetItems.find(i => i.id === selection.item) : undefined);
  const control = $derived(item ? controlById(item.control) : undefined);
  const def = $derived(control ? controlTypes.get(control.type) : undefined);
  const cell = $derived(selection && 'cell' in selection ? selection.cell : undefined);
  let existingOpen = $state(true);
  let existingQuery = $state('');
  const existingRows = $derived(buildExistingControlRows(settings.controls, allItems, controlTypes).filter(row => row.uses > 0 && !!findPlacement(row.typeId)));
  const filteredExistingRows = $derived(searchExistingControls(existingRows, existingQuery));

  function findPlacement(typeId: string, requested?: { w: number; h: number }, ignoredItemId?: string) {
    const current = layoutFor(settings, layoutTarget.skinId, layoutTarget.pageId, layoutTarget.slotId);
    const slot = current?.slot, geometry = current?.geometry;
    if (!current || !slot || !geometry || slot.accepts && !slot.accepts.includes(typeId) ||
      slot.max !== undefined && current.items.length - (ignoredItemId ? 1 : 0) >= slot.max) return null;
    const bounds = effectiveSize(layoutTarget.skinId, slot, typeId);
    if (!bounds) return null;
    const w = requested?.w ?? bounds.default.w, h = requested?.h ?? bounds.default.h;
    if (w < bounds.min.w || h < bounds.min.h || w > bounds.max.w || h > bounds.max.h) return null;
    const occupied = ignoredItemId ? current.items.filter(entry => entry.id !== ignoredItemId) : current.items;
    const at = cell && fits(occupied, { ...cell, w, h }, geometry) ? cell : firstFree(occupied, w, h, geometry);
    return at ? { ...at, w, h } : null;
  }
  function writeItems(items: import('../core/layout').Item[], label: string, addedControl?: ControlConfig) {
    const draft = { ...settings, controls: addedControl ? [...settings.controls, addedControl] : settings.controls } as typeof settings;
    if (!canSetLayoutItems(draft, layoutTarget, items)) return false;
    commit(label);
    if (addedControl) settings.controls.push(addedControl);
    if (setLayoutItems(settings, layoutTarget, items)) return true;
    if (addedControl) settings.controls = settings.controls.filter(entry => entry.id !== addedControl.id);
    return false;
  }
  function placement(typeId: string, w: number, h: number) {
    const at = findPlacement(typeId, { w, h });
    if (!at) toast.error('No free space for this widget');
    return at;
  }
  function placeExisting(controlId: string) {
    const existing = settings.controls.find(c => c.id === controlId);
    const type = existing && controlTypes.get(existing.type);
    if (!existing || !type) return;
    const bounds = targetSlot && effectiveSize(layoutTarget.skinId, targetSlot, type.type);
    const at = bounds && placement(type.type, bounds.default.w, bounds.default.h);
    if (!at) {
      toast.error('No free space for this widget');
      return;
    }
    // An independent copy: each placed widget keeps its own state.
    const copy = { ...cloneControl($state.snapshot(existing) as ControlConfig), id: newId(existing.id, settings.controls.map(c => c.id)) };
    const id = newId('i', allItems.map(i => i.id));
    const item = { id, control: copy.id, ...at };
    if (!writeItems([...targetItems, item], 'Add widget', copy)) { toast.error('No free space for this widget'); return; }
    onselect({ item: id }, layoutTarget);
  }
  function addNew(type: string) {
    const t = controlTypes.get(type);
    if (!t) return;
    const bounds = targetSlot && effectiveSize(layoutTarget.skinId, targetSlot, t.type);
    const at = bounds && placement(t.type, bounds.default.w, bounds.default.h);
    if (!at) {
      toast.error('No free space for this widget');
      return;
    }
    const c = normalizeControl({ id: newId(t.title, settings.controls.map(x => x.id)), type, ...structuredClone(t.create()) });
    const id = newId('i', allItems.map(i => i.id));
    const item = { id, control: c.id, ...at };
    if (!writeItems([...targetItems, item], `Add ${t.title}`, c)) { toast.error('No free space for this widget'); return; }
    onselect({ item: id }, layoutTarget);
  }
  function duplicate() {
    if (!control || !item) return;
    const at = placement(control.type, item.w, item.h);
    if (!at) return;
    const copy = { ...structuredClone($state.snapshot(control)), id: newId(control.name, settings.controls.map(x => x.id)), name: `${control.name} copy` };
    const id = newId('i', allItems.map(i => i.id));
    const duplicated = { id, control: copy.id, ...at };
    if (!writeItems([...targetItems, duplicated], `Duplicate ${control.name}`, copy as ControlConfig)) { toast.error('No free space for this widget'); return; }
    onselect({ item: id }, layoutTarget);
  }
  async function removeItem() {
    if (!item) return;
    const removing = { ...item }, target = { ...layoutTarget }, pageId = page.id, name = control?.name ?? 'widget';
    await animateRemoval(removing.id);
    if (layoutTarget.skinId !== target.skinId || layoutTarget.pageId !== target.pageId || layoutTarget.slotId !== target.slotId ||
      !layoutFor(settings, target.skinId, target.pageId, target.slotId)?.items.some(i => i.id === removing.id)) return;
    commit(`Delete ${name}`);
    const result = removePlacement(settings.deck.pages, pageId, removing.id, settings.skinLayouts);
    if (!result.item) return;
    settings.deck.pages = result.pages;
    settings.skinLayouts = result.skinLayouts;
    if (result.orphanControl) {
      settings.controls = settings.controls.filter(c => c.id !== removing.control);
      delete settings.variants[removing.control];
    }
    if (selection && 'item' in selection && selection.item === removing.id) onselect(null, layoutTarget);
  }
  function resize(w: number, h: number) {
    const bounds = def && targetSlot && effectiveSize(layoutTarget.skinId, targetSlot, def.type);
    if (!item || !bounds || w < bounds.min.w || h < bounds.min.h || w > bounds.max.w || h > bounds.max.h ||
      !fits(targetItems, { x: item.x, y: item.y, w, h }, targetGeometry, [item.id])) return;
    const next = targetItems.map(current => current.id === item.id ? { ...current, w, h } : current);
    writeItems(next, 'Resize widget');
  }
  function setGrid(key: 'rows' | 'cols' | 'size' | 'gap', v: number) {
    page[key] = v;
  }
  // Items outside a shrunk grid are only hidden while the slider is held; releasing it removes them.
  function commitGrid(key: 'rows' | 'cols' | 'size' | 'gap') {
    if (key === 'rows' || key === 'cols') page.items = clampToGrid(page.items, page);
  }
  function setSizing(auto: boolean) {
    const sizing = auto ? 'auto' : 'manual';
    if (page.sizing === sizing) return;
    commit('Deck sizing');
    page.sizing = sizing;
  }
  const addVariant = () => control!.variants.length < MAX_VARIANTS && control!.variants.push({ ...structuredClone($state.snapshot(control!.variants.at(-1)!)),
    id: newScenarioId(), label: '' } as Variant);
  let variantList = $state<HTMLElement>();
  let skipVariantFlip = false;
  function variantId(variant: Variant, index: number) { return variant.id ?? `state-${index + 1}`; }
  function reorderVariant(from: number, to: number, label?: string) {
    if (!control) return;
    if (label) commit(label);
    settings.variants[control.id] = moveVariant(control, settings.variants[control.id] ?? 0, from, to);
  }
  function variantItems() { return [...(variantList?.querySelectorAll<HTMLElement>('[data-variant-card]') ?? [])]; }
  function moveVariantAt(from: number, to: number) {
    if (!control) return;
    skipVariantFlip = true;
    reorderVariant(from, to, 'Reorder variants');
    setTimeout(() => { skipVariantFlip = false; }, 50);
  }
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

<aside class="flex h-full w-full min-w-0 flex-col bg-sidebar">
  {#if control && item && def}
    {@const sizeBounds = targetSlot && effectiveSize(layoutTarget.skinId, targetSlot, control.type)}
    <header class="flex h-12 shrink-0 items-center gap-3 border-b border-[#262626] px-4">
      <p class="min-w-0 flex-1 truncate text-base font-semibold">{def.title}</p>
      <Button size="icon-sm" variant="ghost" aria-label="Duplicate" onclick={duplicate}><Copy /></Button>
      <Button size="icon-sm" variant="ghost" class="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label="Remove" onclick={removeItem}><Trash /></Button>
      <span class="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true"></span>
      <Button size="icon-sm" variant="ghost" aria-label="Close inspector" onclick={onclose}><X /></Button>
    </header>
    <div class="grid min-h-0 min-w-0 flex-1 content-start gap-5 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]">
      <div class="grid gap-1.5"><Label class="text-xs font-semibold uppercase tracking-wide text-muted-foreground" for="wname">Name</Label><Input id="wname" bind:value={control.name} /></div>
      <div class="grid gap-1.5">
        <Label class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Size</Label>
        <div class="grid grid-cols-2 gap-3 text-sm">
          {#each [['w', 'Width'], ['h', 'Height']] as [k, label] (k)}
            <div class="grid gap-2">
              <span class="text-xs text-muted-foreground">{label}</span>
              <div class="flex items-center gap-2">
                <Button size="icon-sm" variant="outline" aria-label="Decrease {label.toLowerCase()}" onclick={() => resize(k === 'w' ? item.w - 1 : item.w, k === 'h' ? item.h - 1 : item.h)}
                  disabled={!sizeBounds || (k === 'w' ? item.w : item.h) <= (k === 'w' ? sizeBounds.min.w : sizeBounds.min.h)}>−</Button>
                <span class="w-4 text-center tabular-nums">{k === 'w' ? item.w : item.h}</span>
                <Button size="icon-sm" variant="outline" aria-label="Increase {label.toLowerCase()}" onclick={() => resize(k === 'w' ? item.w + 1 : item.w, k === 'h' ? item.h + 1 : item.h)}
                  disabled={!sizeBounds || (k === 'w' ? item.w : item.h) >= (k === 'w' ? sizeBounds.max.w : sizeBounds.max.h)}>+</Button>
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
      {:else if control.type === 'media'}
        <MediaEditor {control} />
        <Separator />
        <section class="grid gap-3">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scenario</h3>
          <GestureEditor {control} onedit={trigger => oneditScenario(control.id, item.id, trigger)} />
        </section>
      {:else if control.type === 'web'}
        <WebEditor {control} />
        <Separator />
        <section class="grid gap-3">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scenario</h3>
          <GestureEditor {control} onedit={trigger => oneditScenario(control.id, item.id, trigger)} />
        </section>
      {:else}
        <section class="grid gap-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Variants</h3>
            <Button variant="ghost" size="sm" disabled={control.variants.length >= MAX_VARIANTS} onclick={addVariant}><Plus /> Add</Button>
          </div>
          <div bind:this={variantList} use:sortable={{ axis: 'y', items: variantItems, handle: '[data-sort-handle]', onmove: moveVariantAt }} class="relative grid gap-3">
          {#each control.variants as variant, i (variantId(variant, i))}
            <div data-variant-card data-variant-id={variantId(variant, i)} animate:variantFlip
              class="relative grid min-w-0 gap-3 rounded-xl border bg-card p-3 transition-[transform,box-shadow] duration-200 ease-out">
              <div class="flex items-end gap-2">
                {#if control.variants.length > 1}
                  <button type="button" data-sort-handle aria-label="Reorder variant" class="mb-2 grid h-6 w-4 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing"
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
    <header class="flex h-12 shrink-0 items-center border-b border-[#262626] px-4"><p class="flex-1 font-semibold">Add widget</p><Button size="icon-sm" variant="ghost" aria-label="Close inspector" onclick={onclose}><X /></Button></header>
    <div class="grid min-h-0 min-w-0 flex-1 content-start gap-2 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]">
      {#each [...controlTypes.values()] as t (t.type)}
        {@const bounds = targetSlot && effectiveSize(layoutTarget.skinId, targetSlot, t.type)}
        {@const fit = bounds ? findPlacement(t.type) : null}
        {#if bounds && (!targetSlot?.accepts || targetSlot.accepts.includes(t.type))}
        <button type="button" aria-disabled={!fit} onclick={() => addNew(t.type)}
          class:opacity-45={!fit}
          class="flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.02] p-3 text-left transition hover:border-white/20 hover:bg-white/[.05]">
          <span class="grid size-10 place-items-center rounded-lg bg-white/5"><Icon name={t.icon} size={20} /></span>
          <span class="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium"><span class="min-w-0 truncate">{t.title}</span><PluginMark plugin={t.plugin} /></span>
          <span class="text-xs tabular-nums text-muted-foreground">{fit?.w ?? t.size.w}×{fit?.h ?? t.size.h}</span>
        </button>
        {/if}
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
                {@const fit = type ? findPlacement(row.typeId) : null}
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
                  <span class="shrink-0 text-xs tabular-nums text-muted-foreground" aria-label="Used in {row.uses} placements">{row.uses} {row.uses === 1 ? 'use' : 'uses'}</span>
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

  {:else if layoutTarget.skinId === 'deck'}
    <header class="flex h-12 shrink-0 items-center border-b border-[#262626] px-4"><p class="flex-1 font-semibold">Deck</p><Button size="icon-sm" variant="ghost" aria-label="Close inspector" onclick={onclose}><X /></Button></header>
    <div class="grid min-h-0 min-w-0 flex-1 content-start gap-6 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]">
      <Section title="Canvas">
        <Row label="Colour" wide><ColorField palette={['#0a0a0a', '#171717', '#0f172a', '#1e1b4b', '#052e16', '#3f0d12']} value={withAlpha(settings.display.background.color, settings.display.background.opacity)}
          onchange={v => { const p = splitAlpha(v); commit('Canvas colour'); settings.display.background = { ...settings.display.background, color: p.hex, opacity: p.alpha }; }} /></Row>
        <Row label="Corner radius"><div class="flex w-44 items-center gap-3">
          <Slider type="single" class="min-w-0 flex-1" value={settings.display.background.radius} min={0} max={60} step={1} onValueChange={v => { commit('Canvas radius'); settings.display.background = { ...settings.display.background, radius: v }; }} />
          <span class="w-10 text-right text-sm tabular-nums text-muted-foreground">{settings.display.background.radius}px</span>
        </div></Row>
      </Section>
      <Section title="Grid">
        <Row label="Auto fit" for="auto-fit"><Switch id="auto-fit" checked={page.sizing === 'auto'} onCheckedChange={setSizing} /></Row>
        {#each [{ k: 'rows', label: 'Rows', min: 1, max: 8 }, { k: 'cols', label: 'Columns', min: 1, max: 14 },
          ...(page.sizing === 'manual' ? [{ k: 'size', label: 'Cell size', min: 60, max: 240, unit: 'px' }] : []),
          { k: 'gap', label: 'Gap', min: 0, max: 40, unit: 'px' }] as s (s.k)}
          {@const key = s.k as 'rows' | 'cols' | 'size' | 'gap'}
          <Row label={s.label}><div class="flex w-44 items-center gap-3">
            <Slider type="single" class="min-w-0 flex-1" value={page[key]} min={s.min} max={s.max} step={1} onValueChange={v => setGrid(key, v)} onValueCommit={() => commitGrid(key)} />
            <span class="w-10 text-right text-sm tabular-nums text-muted-foreground">{page[key]}{s.unit ?? ''}</span>
          </div></Row>
        {/each}
      </Section>
    </div>
  {:else}
    <header class="flex h-12 shrink-0 items-center border-b border-[#262626] px-4"><p class="flex-1 font-semibold">{targetSlot?.id ?? 'Slot'}</p><Button size="icon-sm" variant="ghost" aria-label="Close inspector" onclick={onclose}><X /></Button></header>
  {/if}
</aside>

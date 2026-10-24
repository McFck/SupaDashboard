<script lang="ts">
  import { setContext } from 'svelte';
  import { onDestroy, onMount } from 'svelte';
  import type { ControlConfig, TilePresentation } from '../core/controls';
  import { fitSkinDesign, resolveSkinConfig, type SkinDef } from '../core/skins';
  import { SkinInputRecognizer, type SkinCorner, type SkinGesture } from '../core/skin-input';
  import type { SceneInput, SceneRect } from '../core/skin-scene';
  import { currentRuntime, requestPageChange, runtimeView } from '../core/runtime.svelte';
  import { settings, type Page } from '../core/settings.svelte';
  import { SKIN_HOST_CONTEXT, type SkinHostContext } from './context';
  import type { VariableValue } from '../core/variables';

  let { skin, page, mode = 'runtime', visible = true, pageRenderVisible = false, resolvePresentation }:
    { skin: SkinDef; page: Page; mode?: 'runtime' | 'editor'; visible?: boolean; pageRenderVisible?: boolean;
      resolvePresentation?: (control: ControlConfig, variantIndex: number) => TilePresentation } = $props();
  let previewViewId = $state('');
  let quickActionsOpen = $state(false);
  let runtimeOwner = $state(false);
  let skinState = $state<Record<string, VariableValue>>({});
  let width = $state(0), height = $state(0);
  const fit = $derived(skin.design ? fitSkinDesign(width, height, skin.design.width, skin.design.height) : null);
  const scale = $derived(skin.design ? fit?.scale ?? 0 : 1);
  const offsetX = $derived(fit?.offsetX ?? 0), offsetY = $derived(fit?.offsetY ?? 0);
  const viewId = $derived.by(() => {
    if (mode === 'editor') return skin.views.some(view => view.id === previewViewId) ? previewViewId : skin.defaultView;
    const value = skinState.view;
    return typeof value === 'string' && skin.views.some(view => view.id === value) ? value : skin.defaultView;
  });
  async function setView(next: string) {
    if (!skin.views.some(view => view.id === next) || next === context.viewId) return false;
    if (mode === 'editor') { previewViewId = next; return true; }
    const runtime = currentRuntime();
    if (!runtime?.isOwner || !runtimeOwner) return false;
    return runtime.setSkinView(skin.id, next);
  }
  function setQuickActionsOpen(open: boolean) { quickActionsOpen = mode === 'runtime' && runtimeOwner && open; }
  const inputRecognizer = new SkinInputRecognizer(() => setQuickActionsOpen(true));
  function routeSceneInput(input: SceneInput, rect: SceneRect, deliver: (input: SceneInput) => void) {
    const config = context.config;
    const configuredGesture = config.gesture;
    const gesture: SkinGesture = mode !== 'runtime' || !runtimeOwner || !skin.quickActions?.length ? 'off'
      : configuredGesture === 'cornerHold' || configuredGesture === 'off' ? configuredGesture : 'tripleTap';
    const configuredCorner = config.corner;
    const corner: SkinCorner = configuredCorner === 'topLeft' || configuredCorner === 'topRight' || configuredCorner === 'bottomLeft'
      ? configuredCorner : 'bottomRight';
    inputRecognizer.setOptions(gesture, corner);
    return inputRecognizer.handle(input, rect, deliver);
  }
  function resetSceneInput() { inputRecognizer.reset(); }
  function onOriginDown(event: PointerEvent) {
    if (event.target instanceof Element && event.target.closest('[data-skin-input="scene"]')) return;
    resetSceneInput();
  }
  onMount(() => runtimeView.subscribe(snapshot => {
    if (runtimeOwner !== snapshot.owner) runtimeOwner = snapshot.owner;
    const next: Record<string, VariableValue> = {};
    for (const field of skin.state ?? []) {
      const value = snapshot.variables.records[`${skin.id}.${field.key}`]?.value;
      if (value !== undefined) next[field.key] = value;
    }
    const view = snapshot.variables.records[`${skin.id}.view`]?.value;
    if (view !== undefined) next.view = view;
    const keys = new Set([...Object.keys(skinState), ...Object.keys(next)]);
    if ([...keys].some(key => !Object.is(skinState[key], next[key]))) skinState = next;
  }));
  onDestroy(() => inputRecognizer.dispose());
  const context: SkinHostContext = {
    get mode() { return mode; },
    get skin() { return skin; },
    get page() { return Object.assign({}, page, {
      next: () => mode === 'runtime' ? requestPageChange({ direction: 'next' }, 'skin') : Promise.resolve(false),
      prev: () => mode === 'runtime' ? requestPageChange({ direction: 'prev' }, 'skin') : Promise.resolve(false),
    }); },
    get viewId() { return viewId; },
    get designScale() { return scale; },
    get designOffset() { return { x: offsetX, y: offsetY }; },
    get config() { return resolveSkinConfig(skin, settings.skinSettings[skin.id] ?? {}); },
    get state() { return skinState; },
    get visible() { return visible; },
    get pageRenderVisible() { return pageRenderVisible; },
    get resolvePresentation() { return resolvePresentation; },
    setView, routeSceneInput, resetSceneInput,
    get quickActionsOpen() { return quickActionsOpen; }, setQuickActionsOpen,
  };
  setContext(SKIN_HOST_CONTEXT, context);
  const Skin = $derived(skin.component);
  $effect(() => {
    const skinId = skin.id, pageId = page.id, hostVisible = visible, pageVisible = pageRenderVisible;
    const activeView = viewId, owner = runtimeOwner, config = JSON.stringify(context.config);
    void skinId; void pageId; void hostVisible; void pageVisible; void activeView; void owner; void config;
    inputRecognizer.reset();
    quickActionsOpen = false;
  });
</script>

<div bind:clientWidth={width} bind:clientHeight={height} data-skin-host data-skin-id={skin.id} class="relative h-full w-full overflow-hidden"
  onpointerdowncapture={onOriginDown}>
  {#if skin.design}
    {#if fit}
      <div class="absolute left-0 top-0" data-skin-design style={`width:${skin.design.width}px;height:${skin.design.height}px;transform:translate(${offsetX}px,${offsetY}px) scale(${scale});transform-origin:top left`}>
        <Skin {page} />
      </div>
    {/if}
  {:else}
    <div class="absolute inset-0"><Skin {page} /></div>
  {/if}
</div>

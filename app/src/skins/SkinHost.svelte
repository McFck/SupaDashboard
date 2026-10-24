<script lang="ts">
  import { setContext } from 'svelte';
  import type { ControlConfig, TilePresentation } from '../core/controls';
  import { fitSkinDesign, type SkinDef } from '../core/skins';
  import { settings, type Page } from '../core/settings.svelte';
  import { SKIN_HOST_CONTEXT, type SkinHostContext } from './context';

  let { skin, page, mode = 'runtime', visible = true, pageRenderVisible = false, resolvePresentation }:
    { skin: SkinDef; page: Page; mode?: 'runtime' | 'editor'; visible?: boolean; pageRenderVisible?: boolean;
      resolvePresentation?: (control: ControlConfig, variantIndex: number) => TilePresentation } = $props();
  let viewId = $state('');
  let quickActionsOpen = $state(false);
  let width = $state(0), height = $state(0);
  const fit = $derived(skin.design ? fitSkinDesign(width, height, skin.design.width, skin.design.height) : null);
  const scale = $derived(skin.design ? fit?.scale ?? 0 : 1);
  const offsetX = $derived(fit?.offsetX ?? 0), offsetY = $derived(fit?.offsetY ?? 0);
  async function setView(next: string) {
    if (!skin.views.some(view => view.id === next) || next === context.viewId) return false;
    viewId = next;
    return true;
  }
  function setQuickActionsOpen(open: boolean) { quickActionsOpen = open; }
  const context: SkinHostContext = {
    get mode() { return mode; },
    get skin() { return skin; },
    get page() { return page; },
    get viewId() { return skin.views.some(view => view.id === viewId) ? viewId : skin.defaultView; },
    get designScale() { return scale; },
    get designOffset() { return { x: offsetX, y: offsetY }; },
    get config() { return settings.skinSettings[skin.id] ?? {}; },
    get state() { return {}; },
    get visible() { return visible; },
    get pageRenderVisible() { return pageRenderVisible; },
    get resolvePresentation() { return resolvePresentation; },
    setView, get quickActionsOpen() { return quickActionsOpen; }, setQuickActionsOpen,
  };
  setContext(SKIN_HOST_CONTEXT, context);
  const Skin = $derived(skin.component);
  $effect(() => {
    const skinId = skin.id, pageId = page.id, hostVisible = visible;
    if (viewId && !skin.views.some(view => view.id === viewId)) viewId = skin.defaultView;
    void skinId; void pageId; void hostVisible;
    quickActionsOpen = false;
  });
</script>

<div bind:clientWidth={width} bind:clientHeight={height} data-skin-host data-skin-id={skin.id} class="relative h-full w-full overflow-hidden">
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

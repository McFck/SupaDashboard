<script lang="ts">
  import { setContext } from 'svelte';
  import type { ControlConfig, TilePresentation } from '../core/controls';
  import type { SkinDef } from '../core/skins';
  import { settings, type Page } from '../core/settings.svelte';
  import { SKIN_HOST_CONTEXT, type SkinHostContext } from './context';

  let { skin, page, mode = 'runtime', visible = true, pageRenderVisible = false, resolvePresentation }:
    { skin: SkinDef; page: Page; mode?: 'runtime' | 'editor'; visible?: boolean; pageRenderVisible?: boolean;
      resolvePresentation?: (control: ControlConfig, variantIndex: number) => TilePresentation } = $props();
  let viewId = $state('');
  let quickActionsOpen = $state(false);
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
    get config() { return settings.skinSettings[skin.id] ?? {}; },
    get state() { return {}; },
    get visible() { return visible; },
    get pageRenderVisible() { return pageRenderVisible; },
    get resolvePresentation() { return resolvePresentation; },
    setView, get quickActionsOpen() { return quickActionsOpen; }, setQuickActionsOpen,
  };
  setContext(SKIN_HOST_CONTEXT, context);
  const Skin = $derived(skin.component);
</script>

<div data-skin-host data-skin-id={skin.id} class="relative h-full w-full overflow-hidden">
  <Skin {page} />
</div>

<script lang="ts">
  import type { ControlConfig, TilePresentation } from '../core/controls';
  import type { SkinDef } from '../core/skins';
  import type { Page } from '../core/settings.svelte';
  import type { Selection } from '../core/layout';
  import type { LayoutTarget } from '../core/skin-layouts';
  import SkinHost from '../skins/SkinHost.svelte';

  let { skin, page, previewViewId = $bindable(skin.defaultView), selected = null, onselect, oncontext,
    resolvePresentation }:
    { skin: SkinDef; page: Page; previewViewId?: string; selected?: Selection;
      onselect?: (selection: Selection, target?: LayoutTarget) => void;
      oncontext?: (selection: Exclude<Selection, null>, x: number, y: number, target?: LayoutTarget) => void;
      resolvePresentation?: (control: ControlConfig, variantIndex: number) => TilePresentation } = $props();
</script>

<SkinHost {skin} {page} mode="editor" visible={true} pageRenderVisible={false} bind:previewViewId
  {selected} {onselect} {oncontext} {resolvePresentation} />

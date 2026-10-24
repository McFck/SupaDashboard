<script lang="ts">
  import type { ControlConfig, TilePresentation } from '../../core/controls';
  import type { Page } from '../../core/settings.svelte';
  import DeckGrid from '../../controls/DeckGrid.svelte';
  let { page, pageRenderVisible = false, resolvePresentation }: { page: Page; pageRenderVisible?: boolean;
    resolvePresentation?: (control: ControlConfig, variantIndex: number) => TilePresentation } = $props();
  let width = $state(0), height = $state(0);
</script>

<!-- empty background drags the window -->
<div bind:clientWidth={width} bind:clientHeight={height} class="grid h-full place-items-center">
  <DeckGrid {page} {pageRenderVisible} availableWidth={width} availableHeight={height} {resolvePresentation} />
</div>

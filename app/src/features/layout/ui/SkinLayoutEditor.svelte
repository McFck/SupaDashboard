<script lang="ts">
  import type { ControlConfig, TilePresentation } from '../../controls/model';
  import type { SkinDef } from '../../skins/definition';
  import type { Page } from '../../settings/schema';
  import type { Selection } from '../grid';
  import type { LayoutTarget } from '../skin-layouts';
  import SkinHost from '../../skins/SkinHost.svelte';

  let { skin, page, previewViewId = $bindable(skin.defaultView), selected = null, onselect, oncontext,
    resolvePresentation }:
    { skin: SkinDef; page: Page; previewViewId?: string; selected?: Selection;
      onselect?: (selection: Selection, target?: LayoutTarget) => void;
      oncontext?: (selection: Exclude<Selection, null>, x: number, y: number, target?: LayoutTarget) => void;
      resolvePresentation?: (control: ControlConfig, variantIndex: number) => TilePresentation } = $props();
  let preview = $state<HTMLDivElement>();
  let viewTabs = $state<HTMLDivElement>();
  let frameRect = $state<{ x: number; y: number; width: number; surface: string; edge: string } | null>(null);

  function selectView(viewId: string) {
    if (skin.views.some(view => view.id === viewId)) previewViewId = viewId;
  }

  function keydown(event: KeyboardEvent, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % skin.views.length
      : event.key === 'ArrowLeft' ? (index + skin.views.length - 1) % skin.views.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? skin.views.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    selectView(skin.views[next].id);
    viewTabs?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  $effect(() => {
    const container = preview;
    if (!container || skin.views.length <= 1) { frameRect = null; return; }
    const measure = () => {
      const frame = container.querySelector<HTMLElement>('[data-skin-design]') ?? container.querySelector<HTMLElement>('[data-skin-host]');
      if (!frame) return;
      const root = container.getBoundingClientRect(), rect = frame.getBoundingClientRect(), style = getComputedStyle(frame);
      const surface = style.backgroundColor === 'rgba(0, 0, 0, 0)'
        ? getComputedStyle(frame.firstElementChild ?? frame).backgroundColor : style.backgroundColor;
      const next = { x: rect.left - root.left, y: rect.top - root.top, width: rect.width, surface, edge: style.borderTopColor };
      if (!frameRect || Math.abs(frameRect.x - next.x) > .1 || Math.abs(frameRect.y - next.y) > .1 ||
        Math.abs(frameRect.width - next.width) > .1 || frameRect.surface !== next.surface || frameRect.edge !== next.edge) frameRect = next;
    };
    const observer = new ResizeObserver(measure);
    const observeFrame = () => {
      observer.observe(container);
      const host = container.querySelector<HTMLElement>('[data-skin-host]');
      if (host) observer.observe(host);
      const frame = container.querySelector<HTMLElement>('[data-skin-design]');
      if (frame) observer.observe(frame);
      measure();
    };
    const mutation = new MutationObserver(observeFrame);
    mutation.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    observeFrame();
    const frameId = requestAnimationFrame(measure);
    return () => { cancelAnimationFrame(frameId); mutation.disconnect(); observer.disconnect(); };
  });
</script>

<div bind:this={preview} class="skin-layout-editor relative h-full w-full" class:multi-view={skin.views.length > 1} class:designed={!!skin.design}>
  <SkinHost {skin} {page} mode="editor" visible={true} pageRenderVisible={false} bind:previewViewId
    {selected} {onselect} {oncontext} {resolvePresentation} />
  {#if skin.views.length > 1 && frameRect}
    <div bind:this={viewTabs} role="tablist" aria-label="{skin.title} preview views"
      class="pointer-events-none absolute z-20 flex -translate-y-full items-end justify-center gap-0.5 whitespace-nowrap"
      style="left:{frameRect.x}px;top:{frameRect.y}px;width:{frameRect.width}px;--view-surface:{frameRect.surface};--view-edge:{frameRect.edge}">
      {#each skin.views as view, index (view.id)}
        <button type="button" role="tab" data-skin-view-tab={view.id} aria-selected={previewViewId === view.id}
          tabindex={previewViewId === view.id ? 0 : -1} onkeydown={event => keydown(event, index)} onclick={() => selectView(view.id)}
          class="pointer-events-auto relative h-8 rounded-t-md border border-b-0 px-3 text-xs font-medium outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring {previewViewId === view.id ? 'z-10 border-[var(--view-edge)] bg-[var(--view-surface)] text-foreground' : 'border-border bg-sidebar text-muted-foreground hover:text-foreground'}">
          {view.title}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .skin-layout-editor.multi-view.designed :global([data-skin-design]),
  .skin-layout-editor.multi-view:not(.designed) :global([data-skin-host]) {
    box-sizing: border-box;
    overflow: visible; /* selection handles must not be clipped */
    border: 1px solid #2c3a3d;
    border-radius: 6px;
    background: #10171b;
  }
  .skin-layout-editor.multi-view :global([data-skin-design] canvas) { border-radius: 5px; }
</style>

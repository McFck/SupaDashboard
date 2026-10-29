<script lang="ts">
  import type { AppletDef } from '../../applets/contracts';
  import type { Page } from '../../settings/schema';
  import type { Selection } from '../grid';
  import type { LayoutTarget } from '../applet-layouts';
  import AppletHost from '../../applets/AppletHost.svelte';

  let {
    applet,
    page,
    previewViewId = $bindable(applet.defaultView),
    selected = null,
    onselect,
    oncontext,
  }: {
    applet: AppletDef;
    page: Page;
    previewViewId?: string;
    selected?: Selection;
    onselect?: (selection: Selection, target?: LayoutTarget) => void;
    oncontext?: (
      selection: Exclude<Selection, null>,
      x: number,
      y: number,
      target?: LayoutTarget,
    ) => void;
  } = $props();
  let preview = $state<HTMLDivElement>();
  let viewTabs = $state<HTMLDivElement>();
  let frameRect = $state<{
    x: number;
    y: number;
    width: number;
    surface: string;
    edge: string;
  } | null>(null);

  function selectView(viewId: string) {
    if (applet.views.some((view) => view.id === viewId)) previewViewId = viewId;
  }

  function keydown(event: KeyboardEvent, index: number) {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % applet.views.length
        : event.key === 'ArrowLeft'
          ? (index + applet.views.length - 1) % applet.views.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? applet.views.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    selectView(applet.views[next].id);
    viewTabs?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  $effect(() => {
    const container = preview;
    if (!container || applet.views.length <= 1) {
      frameRect = null;
      return;
    }
    const measure = () => {
      const frame =
        container.querySelector<HTMLElement>('[data-applet-design]') ??
        container.querySelector<HTMLElement>('[data-applet-host]');
      if (!frame) return;
      const root = container.getBoundingClientRect(),
        rect = frame.getBoundingClientRect(),
        style = getComputedStyle(frame);
      const surface =
        style.backgroundColor === 'rgba(0, 0, 0, 0)'
          ? getComputedStyle(frame.firstElementChild ?? frame).backgroundColor
          : style.backgroundColor;
      const next = {
        x: rect.left - root.left,
        y: rect.top - root.top,
        width: rect.width,
        surface,
        edge: style.borderTopColor,
      };
      if (
        !frameRect ||
        Math.abs(frameRect.x - next.x) > 0.1 ||
        Math.abs(frameRect.y - next.y) > 0.1 ||
        Math.abs(frameRect.width - next.width) > 0.1 ||
        frameRect.surface !== next.surface ||
        frameRect.edge !== next.edge
      )
        frameRect = next;
    };
    const observer = new ResizeObserver(measure);
    const observeFrame = () => {
      observer.observe(container);
      const host = container.querySelector<HTMLElement>('[data-applet-host]');
      if (host) observer.observe(host);
      const frame = container.querySelector<HTMLElement>('[data-applet-design]');
      if (frame) observer.observe(frame);
      measure();
    };
    const mutation = new MutationObserver(observeFrame);
    mutation.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    observeFrame();
    const frameId = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(frameId);
      mutation.disconnect();
      observer.disconnect();
    };
  });
</script>

<div
  bind:this={preview}
  class="applet-layout-editor relative h-full w-full"
  class:multi-view={applet.views.length > 1}
  class:designed={!!applet.design}
>
  <AppletHost
    {applet}
    {page}
    mode="editor"
    visible={true}
    pageRenderVisible={false}
    bind:previewViewId
    {selected}
    {onselect}
    {oncontext}
  />
  {#if applet.views.length > 1 && frameRect}
    <div
      bind:this={viewTabs}
      role="tablist"
      aria-label="{applet.title} preview views"
      class="pointer-events-none absolute z-20 flex -translate-y-full items-end justify-center gap-0.5 whitespace-nowrap"
      style="left:{frameRect.x}px;top:{frameRect.y}px;width:{frameRect.width}px;--view-surface:{frameRect.surface};--view-edge:{frameRect.edge}"
    >
      {#each applet.views as view, index (view.id)}
        <button
          type="button"
          role="tab"
          data-applet-view-tab={view.id}
          aria-selected={previewViewId === view.id}
          tabindex={previewViewId === view.id ? 0 : -1}
          onkeydown={(event) => keydown(event, index)}
          onclick={() => selectView(view.id)}
          class="pointer-events-auto relative h-8 rounded-t-md border border-b-0 px-3 text-xs font-medium outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring {previewViewId ===
          view.id
            ? 'z-10 border-[var(--view-edge)] bg-[var(--view-surface)] text-foreground'
            : 'border-border bg-sidebar text-muted-foreground hover:text-foreground'}"
        >
          {view.title}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .applet-layout-editor.multi-view.designed :global([data-applet-design]),
  .applet-layout-editor.multi-view:not(.designed) :global([data-applet-host]) {
    box-sizing: border-box;
    overflow: visible; /* selection handles must not be clipped */
    border: 1px solid #2c3a3d;
    border-radius: 6px;
    background: #10171b;
  }
  .applet-layout-editor.multi-view :global([data-applet-design] canvas) {
    border-radius: 5px;
  }
</style>

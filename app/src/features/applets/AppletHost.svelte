<script lang="ts">
  import { setContext, onMount, onDestroy } from 'svelte';
  import type { ControlConfig, TilePresentation } from '../controls/model';
  import type { AppletDef } from './contracts';
  import type { Page } from '../settings/schema';
  import { APPLET_HOST_CONTEXT } from './context';
  import { runtimeCommands } from '../../app/runtime/commands';
  import { AppletHostController } from './applet-host.svelte';
  let {
    applet,
    page,
    mode = 'runtime',
    visible = true,
    pageRenderVisible = false,
    resolvePresentation,
    previewViewId = $bindable(''),
    selected = null,
    onselect,
    oncontext,
  }: {
    applet: AppletDef;
    page: Page;
    mode?: 'runtime' | 'editor';
    visible?: boolean;
    pageRenderVisible?: boolean;
    resolvePresentation?: (control: ControlConfig, variantIndex: number) => TilePresentation;
    previewViewId?: string;
    selected?: import('../layout/grid').Selection;
    onselect?: (
      selection: import('../layout/grid').Selection,
      target?: import('../layout/applet-layouts').LayoutTarget,
    ) => void;
    oncontext?: (
      selection: Exclude<import('../layout/grid').Selection, null>,
      x: number,
      y: number,
      target?: import('../layout/applet-layouts').LayoutTarget,
    ) => void;
  } = $props();

  const controller = new AppletHostController(
    {
      get applet() {
        return applet;
      },
      get page() {
        return page;
      },
      get mode() {
        return mode;
      },
      get visible() {
        return visible;
      },
      get pageRenderVisible() {
        return pageRenderVisible;
      },
      get resolvePresentation() {
        return resolvePresentation;
      },
      get previewViewId() {
        return previewViewId;
      },
      get selected() {
        return selected;
      },
      get onselect() {
        return onselect;
      },
      get oncontext() {
        return oncontext;
      },
    },
    runtimeCommands,
    (view) => {
      previewViewId = view;
    },
  );
  setContext(APPLET_HOST_CONTEXT, controller);
  const Applet = $derived(applet.component);
  let element = $state<HTMLElement>();
  onMount(() => {
    if (element) {
      controller.mount(element);
    }
  });
  onDestroy(() => controller.destroy());
</script>

<div
  bind:this={element}
  bind:clientWidth={controller.width}
  bind:clientHeight={controller.height}
  data-applet-host
  data-applet-id={applet.id}
  class="relative h-full w-full"
  class:overflow-hidden={mode === 'runtime'}
  style:background={mode === 'runtime' ? applet.background : undefined}
  onpointerdowncapture={(event) => controller.onOriginDown(event)}
>
  {#if applet.design}
    {#if controller.fit}
      <div
        class="absolute left-0 top-0"
        data-applet-design
        style={`width:${applet.design.width}px;height:${controller.fittedHeight}px;transform:translate(${controller.designOffset.x}px,${controller.designOffset.y}px) scale(${controller.designScale});transform-origin:top left`}
      >
        <Applet {page} />
      </div>
    {/if}
  {:else}
    <div class="absolute inset-0"><Applet {page} /></div>
  {/if}
</div>

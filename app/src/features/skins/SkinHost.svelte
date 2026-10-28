<script lang="ts">
  import { setContext, onMount, onDestroy } from 'svelte';
  import type { ControlConfig, TilePresentation } from '../controls/model';
  import type { SkinDef } from './contracts';
  import type { Page } from '../settings/schema';
  import { SKIN_HOST_CONTEXT } from './context';
  import { getRuntimeCommands } from '../../app/runtime/context';
  import { SkinHostController } from './skin-host.svelte';
  let {
    skin,
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
    skin: SkinDef;
    page: Page;
    mode?: 'runtime' | 'editor';
    visible?: boolean;
    pageRenderVisible?: boolean;
    resolvePresentation?: (control: ControlConfig, variantIndex: number) => TilePresentation;
    previewViewId?: string;
    selected?: import('../layout/grid').Selection;
    onselect?: (
      selection: import('../layout/grid').Selection,
      target?: import('../layout/skin-layouts').LayoutTarget,
    ) => void;
    oncontext?: (
      selection: Exclude<import('../layout/grid').Selection, null>,
      x: number,
      y: number,
      target?: import('../layout/skin-layouts').LayoutTarget,
    ) => void;
  } = $props();

  const controller = new SkinHostController(
    {
      get skin() {
        return skin;
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
    getRuntimeCommands(),
    (view) => {
      previewViewId = view;
    },
  );
  setContext(SKIN_HOST_CONTEXT, controller);
  const Skin = $derived(skin.component);
  onMount(() => controller.mount());
  onDestroy(() => controller.destroy());
</script>

<div
  bind:clientWidth={controller.width}
  bind:clientHeight={controller.height}
  data-skin-host
  data-skin-id={skin.id}
  class="relative h-full w-full"
  class:overflow-hidden={mode === 'runtime'}
  onpointerdowncapture={(event) => controller.onOriginDown(event)}
>
  {#if skin.design}
    {#if controller.fit}
      <div
        class="absolute left-0 top-0"
        data-skin-design
        style={`width:${skin.design.width}px;height:${controller.fittedHeight}px;transform:translate(${controller.designOffset.x}px,${controller.designOffset.y}px) scale(${controller.designScale});transform-origin:top left`}
      >
        <Skin {page} />
      </div>
    {/if}
  {:else}
    <div class="absolute inset-0"><Skin {page} /></div>
  {/if}
</div>

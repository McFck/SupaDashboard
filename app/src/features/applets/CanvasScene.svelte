<script
  lang="ts"
  generics="Data"
>
  import { onMount, onDestroy } from 'svelte';
  import type { AppletSceneFactory } from './scene-contracts';
  import { CanvasSceneController } from './canvas-scene.svelte';
  import { getAppletHostContext } from './context';
  let {
    create,
    width,
    height,
    view,
    data,
    revision = data,
    opaque = false,
    class: className = '',
  }: {
    create: AppletSceneFactory<Data>;
    width: number;
    height: number;
    view: string;
    data: Data;
    revision?: unknown;
    opaque?: boolean;
    class?: string;
  } = $props();

  let canvas: HTMLCanvasElement;
  const controller = new CanvasSceneController(
    {
      get canvas() {
        return canvas;
      },
      get create() {
        return create;
      },
      get width() {
        return width;
      },
      get height() {
        return height;
      },
      get view() {
        return view;
      },
      get data() {
        return data;
      },
      get revision() {
        return revision;
      },
      get opaque() {
        return opaque;
      },
    },
    getAppletHostContext(),
  );
  onMount(() => controller.mount());
  onDestroy(() => controller.destroy());
</script>

<canvas
  bind:this={canvas}
  data-applet-input="scene"
  aria-hidden="true"
  class={`block touch-none ${className}`}
  style={`width:${width}px;height:${height}px`}
  onpointerdown={(event) => controller.pointer.input('down', event)}
  onpointermove={(event) => controller.pointer.input('move', event)}
  onpointerup={(event) => controller.pointer.input('up', event)}
  onpointercancel={(event) => controller.pointer.input('cancel', event)}
  onlostpointercapture={(event) => controller.pointer.input('cancel', event)}
></canvas>

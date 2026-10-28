<script
  lang="ts"
  generics="Data"
>
  import { onMount, onDestroy } from 'svelte';
  import type { SkinSceneFactory } from './scene-contracts';
  import { CanvasSceneController } from './canvas-scene.svelte';
  import { getSkinHostContext } from './context';
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
    create: SkinSceneFactory<Data>;
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
    () => ({ canvas, create, width, height, view, data, revision, opaque }),
    getSkinHostContext(),
  );
  onMount(() => controller.mount());
  onDestroy(() => controller.destroy());
</script>

<canvas
  bind:this={canvas}
  data-skin-input="scene"
  aria-hidden="true"
  class={`block touch-none ${className}`}
  style={`width:${width}px;height:${height}px`}
  onpointerdown={(event) => controller.pointer.input('down', event)}
  onpointermove={(event) => controller.pointer.input('move', event)}
  onpointerup={(event) => controller.pointer.input('up', event)}
  onpointercancel={(event) => controller.pointer.input('cancel', event)}
  onlostpointercapture={(event) => controller.pointer.input('cancel', event)}
></canvas>

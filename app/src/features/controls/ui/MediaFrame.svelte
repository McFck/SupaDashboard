<script lang="ts">
  import { onDestroy } from 'svelte';
  let {
    url,
    videoSource,
    fit,
    loop,
    muted,
    opacity,
    resourceVisible,
    playbackAllowed,
    resumeAt,
    onready,
    onposition,
  }: {
    url?: string;
    videoSource: boolean;
    fit: 'cover' | 'contain';
    loop: boolean;
    muted: boolean;
    opacity: number;
    resourceVisible: boolean;
    playbackAllowed: boolean;
    resumeAt?: number;
    onready: (success: boolean) => void;
    onposition: (time: number) => void;
  } = $props();
  let video = $state<HTMLVideoElement>();
  const effectiveMuted = $derived(muted || !playbackAllowed);

  $effect(() => {
    const element = video;
    if (!element) return;
    element.loop = loop;
    element.muted = effectiveMuted;
    if (!resourceVisible || !url) {
      onposition(element.currentTime);
      element.pause();
      element.removeAttribute('src');
      element.load();
      return;
    }
    if (!playbackAllowed) {
      onposition(element.currentTime);
      element.pause();
      return;
    }
    void element.play().catch(() => {});
  });
  onDestroy(() => {
    if (!video) return;
    onposition(video.currentTime);
    video.pause();
    video.removeAttribute('src');
    video.load();
  });
</script>

<div
  class="absolute inset-0 transition-opacity duration-150 motion-reduce:transition-none"
  style:opacity
>
  {#if videoSource}
    <video
      bind:this={video}
      src={resourceVisible ? url : undefined}
      playsinline
      preload={resourceVisible ? 'auto' : 'none'}
      muted={effectiveMuted}
      {loop}
      onloadedmetadata={() => {
        if (!resourceVisible) return;
        if (resumeAt !== undefined && video && video.currentTime < 0.05) {
          try {
            video.currentTime = resumeAt;
          } catch {
            /* metadata may not support seeking yet */
          }
        }
      }}
      onloadeddata={() => {
        if (resourceVisible) onready(true);
      }}
      onerror={() => {
        if (resourceVisible) onready(false);
      }}
      style:object-fit={fit}
      class="block h-full w-full"
    ></video>
  {:else}
    <img
      src={resourceVisible ? url : undefined}
      alt=""
      draggable="false"
      onload={() => {
        if (resourceVisible) onready(true);
      }}
      onerror={() => {
        if (resourceVisible) onready(false);
      }}
      style:object-fit={fit}
      class="block h-full w-full select-none"
    />
  {/if}
</div>

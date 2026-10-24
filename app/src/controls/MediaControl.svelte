<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
  import type { ControlConfig } from '../core/controls';
  import type { Trigger } from '../core/scenario';
  import { currentRuntime, runtimeView } from '../core/runtime.svelte';
  import { canRunContent, watchDashboardVisibility, watchIntersection } from '../core/content-visibility';
  import { hasMediaExtension, isVideoSource, mediaSourceKey, mediaUrl, readMediaOptions } from '../core/content';
  import ContentTile from './ContentTile.svelte';

  let { control, page, pageId, pageVisible = true, pageRendered = true, itemId, pressFeedbackDisabled = false }:
    { control: ControlConfig; page?: import('../core/settings.svelte').Page; pageId?: string;
      pageVisible?: boolean; pageRendered?: boolean; itemId?: string; pressFeedbackDisabled?: boolean } = $props();
  const options = $derived(readMediaOptions(control.options));
  const slide = $derived($runtimeView.content[control.id]?.slide ?? 0);
  const source = $derived(options.sources[slide]);
  const sourceKeyForPosition = $derived(mediaSourceKey(source));
  let tauriAvailable = $state(false);
  const url = $derived.by(() => {
    if (source?.kind === 'url') return mediaUrl(source.value);
    if (source?.kind === 'file' && tauriAvailable) {
      try { return convertFileSrc(source.value); } catch { return undefined; }
    }
    return undefined;
  });
  let visibilityTarget = $state<HTMLElement>();
  let video = $state<HTMLVideoElement>();
  let intersecting = $state(false);
  let documentVisible = $state(true);
  let dashboardVisible = $state(true);
  let unavailable = $state(false);
  let dwellReady = $state(false);
  let videoFrameReady = $state(false);
  let fallbackVideo = $state(false);
  let userPlaybackRequested = $state(false);
  let generation = $state(0);
  let sourceKey = $state('');
  const displayEligible = $derived(pageRendered || pressFeedbackDisabled);
  const isVideo = $derived(!!source && (fallbackVideo || isVideoSource(source)));
  const canRun = $derived(canRunContent({ runtimeOwner: $runtimeView.owner, editing: pressFeedbackDisabled,
    pageVisible, intersecting, documentVisible, dashboardVisible }));
  const canPrimeVideo = $derived($runtimeView.owner && !pressFeedbackDisabled && pageRendered && !pageVisible &&
    !videoFrameReady && documentVisible && dashboardVisible);

  $effect(() => {
    const node = visibilityTarget;
    if (!node) { intersecting = false; return; }
    return watchIntersection(node, value => intersecting = value);
  });

  $effect(() => {
    const key = JSON.stringify([slide, sourceKeyForPosition, url]);
    if (key === sourceKey) return;
    sourceKey = key;
    generation++;
    fallbackVideo = false;
    unavailable = !url;
    dwellReady = !url;
    videoFrameReady = false;
    userPlaybackRequested = false;
  });

  $effect.pre(() => {
    if (video && !canRun && $runtimeView.owner && sourceKeyForPosition)
      currentRuntime()?.rememberVideoPosition(control.id, sourceKeyForPosition, video.currentTime);
  });

  $effect(() => {
    if (!canRun || options.interval === 0 || !dwellReady || options.sources.length < 2 || isVideo && !unavailable ||
      !options.loop && slide >= options.sources.length - 1) return;
    const currentGeneration = generation;
    const timer = setTimeout(() => {
      if (currentGeneration !== generation) return;
      try { currentRuntime()?.contentCommand(control.id, 'next'); } catch { /* the control may have been deleted */ }
    }, options.interval * 1000);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const element = video;
    const positionKey = sourceKeyForPosition;
    const token = generation;
    if (!element) return;
    element.muted = pressFeedbackDisabled || !canRun || options.muted;
    element.loop = options.sources.length === 1 && options.loop;
    if ((!canRun && !canPrimeVideo) || (!options.muted && !userPlaybackRequested && !canPrimeVideo)) {
      if (!canRun && positionKey) currentRuntime()?.rememberVideoPosition(control.id, positionKey, element.currentTime);
      element.pause();
      return;
    }
    const saved = currentRuntime()?.videoPosition(control.id, positionKey);
    if (saved !== undefined && element.currentTime < 0.05) {
      try { element.currentTime = saved; } catch { /* metadata may not support seeking yet */ }
    }
    void element.play().then(() => {
      if (token !== generation || element !== video || (!canRun && !canPrimeVideo)) element.pause();
    }).catch(() => {});
    return () => {
      if (mediaSourceKey(source) === positionKey && positionKey)
        currentRuntime()?.rememberVideoPosition(control.id, positionKey, element.currentTime);
      element.pause();
      if (element !== video) {
        element.removeAttribute('src');
        element.load();
      }
    };
  });

  function settle(token: number, key: string, success: boolean) {
    if (token !== generation || key !== sourceKey) return;
    unavailable = !success;
    dwellReady = true;
  }
  function imageError(token: number, key: string) {
    if (token !== generation || key !== sourceKey) return;
    if (source && !hasMediaExtension(source) && !fallbackVideo) {
      generation++;
      fallbackVideo = true;
      unavailable = false;
      dwellReady = false;
      videoFrameReady = false;
      return;
    }
    settle(token, key, false);
  }
  function videoLoaded(token: number, key: string) {
    if (token !== generation || key !== sourceKey) return;
    unavailable = false;
    dwellReady = true;
    const saved = currentRuntime()?.videoPosition(control.id, sourceKeyForPosition);
    if (video && saved !== undefined && video.currentTime < 0.05) {
      try { video.currentTime = saved; } catch { /* seeking can wait until the media is ready */ }
    }
  }
  function videoError(token: number, key: string) {
    if (token !== generation || key !== sourceKey) return;
    unavailable = true;
    dwellReady = true;
  }
  function videoFrameLoaded(token: number, key: string) {
    if (token !== generation || key !== sourceKey) return;
    videoLoaded(token, key);
    videoFrameReady = true;
  }
  function advanceVideo(token: number, key: string) {
    if (token !== generation || key !== sourceKey || !canRun || options.interval === 0 || options.sources.length < 2) return;
    try { currentRuntime()?.contentCommand(control.id, 'next'); } catch { /* the control may have been deleted */ }
  }
  function onCommitted(trigger: Trigger) {
    if (trigger !== 'press' || options.muted || !canRun || !video) return;
    userPlaybackRequested = true;
    video.muted = false;
    const element = video, token = generation;
    void element.play().then(() => {
      if (token !== generation || element !== video || !canRun) element.pause();
    }).catch(() => { userPlaybackRequested = false; });
  }
  function rememberPosition(key: string, element: HTMLVideoElement) {
    if ($runtimeView.owner && key) currentRuntime()?.rememberVideoPosition(control.id, key, element.currentTime);
  }
  function pauseAndRemember(element: HTMLVideoElement) {
    rememberPosition(sourceKeyForPosition, element);
    element.pause();
  }

  onMount(() => {
    tauriAvailable = isTauri();
    let disposed = false;
    let stopDashboard = () => {};
    const updateDocument = () => { documentVisible = document.visibilityState === 'visible'; };
    updateDocument();
    document.addEventListener('visibilitychange', updateDocument);
    void watchDashboardVisibility(value => dashboardVisible = value).then(stop => {
      if (disposed) stop(); else stopDashboard = stop;
    }).catch(() => {});
    return () => {
      disposed = true;
      stopDashboard();
      document.removeEventListener('visibilitychange', updateDocument);
    };
  });
  onDestroy(() => {
    generation++;
    if (video) {
      pauseAndRemember(video);
      video.removeAttribute('src');
      video.load();
    }
  });
</script>

<ContentTile {control} {page} {pageId} {pageVisible} {itemId} {pressFeedbackDisabled} {onCommitted}>
  {#snippet children()}
    <div bind:this={visibilityTarget} class="h-full w-full">
      {#if displayEligible}
        {@const token = generation}{@const key = sourceKey}
        {#if !url || unavailable}
          <div class="grid h-full w-full place-items-center text-sm text-muted-foreground">Unavailable</div>
        {:else if isVideo}
          <video bind:this={video} src={url} playsinline preload="auto"
            muted={pressFeedbackDisabled || !canRun || options.muted}
            loop={options.sources.length === 1 && options.loop}
            onloadedmetadata={() => videoLoaded(token, key)} onloadeddata={() => videoFrameLoaded(token, key)}
            oncanplay={() => videoFrameLoaded(token, key)}
            onerror={() => videoError(token, key)}
            onended={() => advanceVideo(token, key)}
            style="object-fit: {options.fit}" class="block h-full w-full"></video>
        {:else}
          <img src={url} alt="" draggable="false" onload={() => settle(token, key, true)}
            onerror={() => imageError(token, key)} style="object-fit: {options.fit}"
            class="block h-full w-full select-none" />
        {/if}
      {/if}
    </div>
  {/snippet}
</ContentTile>

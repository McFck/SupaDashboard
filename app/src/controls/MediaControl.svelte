<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
  import type { ControlConfig } from '../core/controls';
  import type { Trigger } from '../core/scenario';
  import { currentRuntime, runtimeView } from '../core/runtime.svelte';
  import { canRunContent, mediaContentPages, watchDashboardVisibility, watchIntersection } from '../core/content-visibility';
  import { hasMediaExtension, isVideoSource, mediaSourceKey, mediaUrl, readMediaOptions, stepSlide } from '../core/content';
  import { preloadNextMedia } from '../core/media-cache';
  import ContentTile from './ContentTile.svelte';
  import MediaFrame from './MediaFrame.svelte';

  type MediaLayer = { key: string; url?: string; video: boolean; fit: 'cover' | 'contain'; loop: boolean; muted: boolean; token: number };
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
  let intersecting = $state(false);
  let documentVisible = $state(true);
  let dashboardVisible = $state(true);
  let unavailable = $state(false);
  let dwellReady = $state(false);
  let targetReady = $state(false);
  let fallbackVideo = $state(false);
  let userPlaybackRequested = $state(false);
  let generation = $state(0);
  let identity = '';
  let sourceIdentity = '';
  let mediaTarget = $state<MediaLayer | null>(null);
  let mediaPrevious = $state<MediaLayer | null>(null);
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  const displayEligible = $derived(pageRendered || pressFeedbackDisabled);
  const resourceVisible = $derived(displayEligible && (pressFeedbackDisabled ||
    ((!pageId || $mediaContentPages.has(pageId)) && documentVisible && dashboardVisible)));
  const isVideo = $derived(!!source && (fallbackVideo || isVideoSource(source)));
  const canRun = $derived(canRunContent({ runtimeOwner: $runtimeView.owner, editing: pressFeedbackDisabled,
    pageVisible, intersecting, documentVisible, dashboardVisible }));
  const canPrimeVideo = $derived($runtimeView.owner && !pressFeedbackDisabled && resourceVisible && !pageVisible &&
    !targetReady && documentVisible && dashboardVisible);
  const sourceCandidate = $derived({ key: sourceKeyForPosition, url, video: isVideo,
    fit: source?.fit ?? 'cover', loop: source?.loop ?? true, muted: options.muted || (source?.muted ?? true) });

  $effect(() => {
    const node = visibilityTarget;
    if (!node) { intersecting = false; return; }
    return watchIntersection(node, value => intersecting = value);
  });

  $effect(() => {
    const candidate = sourceCandidate;
    const nextIdentity = JSON.stringify([candidate.key, candidate.url, candidate.video]);
    if (nextIdentity === identity) return;
    identity = nextIdentity;
    const nextSourceIdentity = JSON.stringify([candidate.key, candidate.url]);
    const sourceChanged = nextSourceIdentity !== sourceIdentity;
    sourceIdentity = nextSourceIdentity;
    generation++;
    const previous = untrack(() => mediaTarget);
    const previousFrame = untrack(() => targetReady ? previous : mediaPrevious);
    clearTimeout(fadeTimer);
    mediaPrevious = resourceVisible && previousFrame?.url && !untrack(() => unavailable) ? previousFrame : null;
    mediaTarget = { ...candidate, token: generation };
    if (sourceChanged) fallbackVideo = false;
    unavailable = !candidate.url;
    targetReady = !candidate.url;
    dwellReady = !candidate.url;
    userPlaybackRequested = false;
    if (!candidate.url) finishPreviousFade();
  });

  $effect(() => {
    const element = source;
    const visible = resourceVisible;
    if (!visible || !documentVisible || !dashboardVisible || !element || options.sources.length < 2) return;
    const nextIndex = stepSlide(slide, options.sources.length, 1, options.loop);
    if (nextIndex === slide) return;
    const next = options.sources[nextIndex];
    const nextUrl = next.kind === 'url' ? mediaUrl(next.value) : tauriAvailable ? safeFileUrl(next.value) : undefined;
    if (!nextUrl) return;
    return preloadNextMedia(control.id, nextUrl, isVideoSource(next));
  });

  $effect(() => {
    if (!canRun || options.interval === 0 || !dwellReady || options.sources.length < 2 ||
      (!options.loop && slide >= options.sources.length - 1)) return;
    const currentGeneration = generation;
    const timer = setTimeout(() => {
      if (currentGeneration !== generation) return;
      try { currentRuntime()?.contentCommand(control.id, 'next'); } catch { /* the control may have been deleted */ }
    }, options.interval * 1000);
    return () => clearTimeout(timer);
  });

  function safeFileUrl(path: string) {
    try { return convertFileSrc(path); } catch { return undefined; }
  }

  function finishPreviousFade() {
    clearTimeout(fadeTimer);
    if (!mediaPrevious) return;
    fadeTimer = setTimeout(() => { mediaPrevious = null; }, 180);
  }

  function frameReady(token: number, success: boolean) {
    if (token !== generation) return;
    if (!success && source && !hasMediaExtension(source) && !fallbackVideo && !mediaTarget?.video) {
      fallbackVideo = true;
      return;
    }
    unavailable = !success;
    targetReady = true;
    dwellReady = true;
    finishPreviousFade();
  }

  function rememberPosition(key: string, time: number) {
    if ($runtimeView.owner && key) currentRuntime()?.rememberVideoPosition(control.id, key, time);
  }

  function onCommitted(trigger: Trigger) {
    if (trigger !== 'press' || sourceCandidate.muted || !canRun) return;
    userPlaybackRequested = true;
  }

  function layerOpacity(layer: MediaLayer) {
    if (layer.token === mediaTarget?.token) return targetReady && !unavailable ? 1 : mediaPrevious ? 0 : 1;
    return targetReady ? 0 : 1;
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
    clearTimeout(fadeTimer);
  });
</script>

<ContentTile {control} {page} {pageId} {pageVisible} {itemId} {pressFeedbackDisabled} {onCommitted}>
  {#snippet children()}
    <div bind:this={visibilityTarget} class="relative h-full w-full">
      {#if displayEligible}
        {#if mediaPrevious}
          {@const previousLayer = mediaPrevious}
          {#key previousLayer.token}
            <MediaFrame url={previousLayer.url} videoSource={previousLayer.video} fit={previousLayer.fit}
              loop={previousLayer.loop} muted={previousLayer.muted} opacity={layerOpacity(previousLayer)}
              {resourceVisible} playbackAllowed={false}
              resumeAt={currentRuntime()?.videoPosition(control.id, previousLayer.key)}
              onready={() => {}} onmetadata={() => {}}
              onposition={time => rememberPosition(previousLayer.key, time)} />
          {/key}
        {/if}
        {#if mediaTarget}
          {@const targetLayer = mediaTarget}
          {@const currentTarget = sourceKeyForPosition === targetLayer.key && url === targetLayer.url}
          {#key targetLayer.token}
            <MediaFrame url={targetLayer.url} videoSource={targetLayer.video}
              fit={currentTarget ? source?.fit ?? targetLayer.fit : targetLayer.fit}
              loop={currentTarget ? source?.loop ?? targetLayer.loop : targetLayer.loop}
              muted={currentTarget ? options.muted || (source?.muted ?? true) || canPrimeVideo : targetLayer.muted}
              opacity={layerOpacity(targetLayer)} {resourceVisible}
              playbackAllowed={canPrimeVideo || (canRun && (sourceCandidate.muted || userPlaybackRequested))}
              resumeAt={currentRuntime()?.videoPosition(control.id, targetLayer.key)}
              onready={success => frameReady(targetLayer.token, success)} onmetadata={() => {}}
              onposition={time => rememberPosition(targetLayer.key, time)} />
          {/key}
          {#if targetReady && unavailable}
            <div class="absolute inset-0 grid place-items-center text-sm text-muted-foreground transition-opacity duration-150"
              style:opacity={unavailable ? 1 : 0}>Unavailable</div>
          {/if}
        {/if}
      {/if}
    </div>
  {/snippet}
</ContentTile>

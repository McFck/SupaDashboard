<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { convertFileSrc } from '@tauri-apps/api/core';
  import type { ControlConfig } from '../model';
  import type { Trigger } from '../../automation/scenario';
  import { runtimeView } from '../../../app/runtime/state';
  import {
    canRunContent,
    mediaContentPages,
    watchDashboardVisibility,
    watchIntersection,
  } from '../../media/content-visibility';
  import {
    hasMediaExtension,
    isVideoSource,
    mediaFileUrl,
    mediaSourceKey,
    mediaUrl,
    readMediaOptions,
    stepSlide,
  } from '../../media/content';
  import { preloadNextMedia } from '../../media/media-cache';
  import ContentTile from './ContentTile.svelte';
  import EmptyContent from './EmptyContent.svelte';
  import MediaFrame from './MediaFrame.svelte';
  import { runtimeCommands } from '../../../app/runtime/commands';

  const { contentCommand, rememberVideoPosition, videoPosition } = runtimeCommands;

  type MediaLayer = {
    key: string;
    url?: string;
    video: boolean;
    fit: 'cover' | 'contain';
    loop: boolean;
    muted: boolean;
    token: number;
  };
  let {
    control,
    pageId,
    pageVisible = true,
    pageRendered = true,
    itemId,
    pressFeedbackDisabled = false,
  }: {
    control: ControlConfig;
    pageId?: string;
    pageVisible?: boolean;
    pageRendered?: boolean;
    itemId?: string;
    pressFeedbackDisabled?: boolean;
  } = $props();
  const options = $derived(readMediaOptions(control.options));
  const slide = $derived($runtimeView.content[control.id]?.slide ?? 0);
  const source = $derived(options.sources[slide]);
  const sourceKeyForPosition = $derived(mediaSourceKey(source));
  const url = $derived.by(() => {
    if (source?.kind === 'url') return mediaUrl(source.value);
    return mediaFileUrl(source, convertFileSrc);
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
  let preloadIdentity = '';
  let releasePreload = () => {};
  const displayEligible = $derived(pageRendered || pressFeedbackDisabled);
  const resourceVisible = $derived(
    displayEligible &&
      (pressFeedbackDisabled ||
        ((!pageId || $mediaContentPages.has(pageId)) && documentVisible && dashboardVisible)),
  );
  const isVideo = $derived(!!source && (fallbackVideo || isVideoSource(source)));
  const canRun = $derived(
    canRunContent({
      runtimeOwner: $runtimeView.owner,
      editing: pressFeedbackDisabled,
      pageVisible,
      intersecting,
      documentVisible,
      dashboardVisible,
    }),
  );
  const canPrimeVideo = $derived(
    $runtimeView.owner &&
      !pressFeedbackDisabled &&
      resourceVisible &&
      !pageVisible &&
      !targetReady &&
      documentVisible &&
      dashboardVisible,
  );
  const sourceCandidate = $derived({
    key: sourceKeyForPosition,
    url,
    video: isVideo,
    fit: source?.fit ?? 'cover',
    loop: source?.loop ?? true,
    muted: options.muted || (source?.muted ?? true),
  });

  $effect(() => {
    const node = visibilityTarget;
    if (!node) {
      intersecting = false;
      return;
    }
    return watchIntersection(node, (value) => (intersecting = value));
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
    const previousFrame = untrack(() => (targetReady ? previous : mediaPrevious));
    clearTimeout(fadeTimer);
    mediaPrevious =
      resourceVisible && previousFrame?.url && !untrack(() => unavailable) ? previousFrame : null;
    mediaTarget = { ...candidate, token: generation };
    if (sourceChanged) fallbackVideo = false;
    unavailable = !candidate.url;
    targetReady = !candidate.url;
    dwellReady = !candidate.url;
    userPlaybackRequested = false;
    if (!candidate.url) finishPreviousFade();
  });

  $effect(() => {
    const visible = resourceVisible && documentVisible && dashboardVisible;
    const canAdvance =
      options.sources.length > 1 && (options.loop || slide < options.sources.length - 1);
    const nextIndex = canAdvance ? stepSlide(slide, options.sources.length, 1, options.loop) : -1;
    const next = nextIndex >= 0 ? options.sources[nextIndex] : undefined;
    const nextUrl =
      next?.kind === 'url' ? mediaUrl(next.value) : mediaFileUrl(next, convertFileSrc);
    const preloadOwner = itemId ?? control.id;
    const nextKey =
      visible && nextUrl && next
        ? JSON.stringify([preloadOwner, mediaSourceKey(next), nextUrl, isVideoSource(next)])
        : '';
    if (nextKey === preloadIdentity) return;
    preloadIdentity = nextKey;
    releasePreload();
    releasePreload = () => {};
    if (nextKey) releasePreload = preloadNextMedia(preloadOwner, nextUrl!, isVideoSource(next!));
  });

  $effect(() => {
    if (
      !canRun ||
      options.interval === 0 ||
      !dwellReady ||
      options.sources.length < 2 ||
      (!options.loop && slide >= options.sources.length - 1)
    )
      return;
    const currentGeneration = generation;
    const timer = setTimeout(() => {
      if (currentGeneration !== generation) return;
      try {
        contentCommand(control.id, 'next');
      } catch {
        /* the control may have been deleted */
      }
    }, options.interval * 1000);
    return () => clearTimeout(timer);
  });

  function finishPreviousFade() {
    clearTimeout(fadeTimer);
    if (!mediaPrevious) return;
    fadeTimer = setTimeout(() => {
      mediaPrevious = null;
    }, 180);
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
    if ($runtimeView.owner && key) rememberVideoPosition(control.id, key, time);
  }

  function onCommitted(trigger: Trigger) {
    if (trigger !== 'press' || sourceCandidate.muted || !canRun) return;
    userPlaybackRequested = true;
  }

  function layerOpacity(layer: MediaLayer) {
    // A failed source hides its frame so the browser's broken-image icon never shows.
    if (layer.token === mediaTarget?.token) {
      if (targetReady) return unavailable ? 0 : 1;
      return mediaPrevious ? 0 : 1;
    }
    return targetReady ? 0 : 1;
  }

  onMount(() => {
    let disposed = false;
    let stopDashboard = () => {};
    const updateDocument = () => {
      documentVisible = document.visibilityState === 'visible';
    };
    updateDocument();
    document.addEventListener('visibilitychange', updateDocument);
    void watchDashboardVisibility((value) => (dashboardVisible = value))
      .then((stop) => {
        if (disposed) stop();
        else stopDashboard = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stopDashboard();
      document.removeEventListener('visibilitychange', updateDocument);
    };
  });

  onDestroy(() => {
    generation++;
    clearTimeout(fadeTimer);
    releasePreload();
  });
</script>

<ContentTile
  {control}
  {pageId}
  {pageVisible}
  {itemId}
  {pressFeedbackDisabled}
  {onCommitted}
>
  {#snippet children()}
    <div
      bind:this={visibilityTarget}
      class="relative h-full w-full"
    >
      {#if displayEligible}
        {#if mediaPrevious}
          {@const previousLayer = mediaPrevious}
          {#key previousLayer.token}
            <MediaFrame
              url={previousLayer.url}
              videoSource={previousLayer.video}
              fit={previousLayer.fit}
              loop={previousLayer.loop}
              muted={previousLayer.muted}
              opacity={layerOpacity(previousLayer)}
              {resourceVisible}
              playbackAllowed={false}
              resumeAt={videoPosition(control.id, previousLayer.key)}
              onready={() => {}}
              onposition={(time) => rememberPosition(previousLayer.key, time)}
            />
          {/key}
        {/if}
        {#if mediaTarget}
          {@const targetLayer = mediaTarget}
          {@const currentTarget =
            sourceKeyForPosition === targetLayer.key && url === targetLayer.url}
          {#key targetLayer.token}
            <MediaFrame
              url={targetLayer.url}
              videoSource={targetLayer.video}
              fit={currentTarget ? (source?.fit ?? targetLayer.fit) : targetLayer.fit}
              loop={currentTarget ? (source?.loop ?? targetLayer.loop) : targetLayer.loop}
              muted={currentTarget
                ? options.muted || (source?.muted ?? true) || canPrimeVideo
                : targetLayer.muted}
              opacity={layerOpacity(targetLayer)}
              {resourceVisible}
              playbackAllowed={canPrimeVideo ||
                (canRun && (sourceCandidate.muted || userPlaybackRequested))}
              resumeAt={videoPosition(control.id, targetLayer.key)}
              onready={(success) => frameReady(targetLayer.token, success)}
              onposition={(time) => rememberPosition(targetLayer.key, time)}
            />
          {/key}
          {#if !source}
            <EmptyContent icon="Image" />
          {:else if targetReady && unavailable}
            <div class="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              Unavailable
            </div>
          {/if}
        {/if}
      {/if}
    </div>
  {/snippet}
</ContentTile>

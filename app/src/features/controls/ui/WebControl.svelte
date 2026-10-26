<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { ControlConfig } from '../model';
  import { runtimeView } from '../../../app/runtime.svelte';
  import { readWebOptions, webUrl } from '../../media/content';
  import { watchDashboardVisibility, watchIntersection } from '../../media/content-visibility';
  import {
    consumeEligibleTime,
    initialWebFrameState,
    reduceWebFrameDomLoad,
    reduceWebFrameState,
    subscribeWebFrameEvents,
    WEB_FRAME_TIMEOUT_MS,
    type WebFrameState,
  } from '../../media/web-frame-status';
  import ContentTile from './ContentTile.svelte';

  let {
    control,
    page,
    pageId,
    pageVisible = true,
    pageRendered = true,
    itemId,
    pressFeedbackDisabled = false,
  }: {
    control: ControlConfig;
    page?: import('../../settings/schema').Page;
    pageId?: string;
    pageVisible?: boolean;
    pageRendered?: boolean;
    itemId?: string;
    pressFeedbackDisabled?: boolean;
  } = $props();
  const options = $derived(readWebOptions(control.options));
  const reload = $derived($runtimeView.content[control.id]?.reload ?? 0);
  const requestedUrl = $derived(webUrl(options.url));
  let observerReady = $state(false);
  let nativeStatus = $state(false);
  let visibilityTarget = $state<HTMLElement>();
  let intersecting = $state(false);
  let documentVisible = $state(true);
  let dashboardVisible = $state(true);
  let frameKey = $state('');
  let attemptUrl = $state<string>();
  let frameState = $state<WebFrameState>(initialWebFrameState(''));
  let timeoutRemaining = $state(WEB_FRAME_TIMEOUT_MS);
  let refreshRemaining = $state(0);
  let sourceToken = '';
  let generation = $state(0);
  let stopFrames: (() => void) | undefined;
  let disposed = false;
  const eligible = $derived(
    pageRendered && pageVisible && intersecting && documentVisible && dashboardVisible,
  );

  function startAttempt(url: string | undefined) {
    generation++;
    attemptUrl = url;
    frameKey = `content:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    frameState = initialWebFrameState(frameKey);
    timeoutRemaining = WEB_FRAME_TIMEOUT_MS;
    refreshRemaining = options.refresh * 1000;
    if (!url) frameState = { ...frameState, status: 'unavailable' };
  }

  $effect(() => {
    const token = JSON.stringify([options.url, reload]);
    if (token === sourceToken) return;
    sourceToken = token;
    startAttempt(requestedUrl);
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
    const canWait = observerReady && eligible && !!attemptUrl;
    const status = frameState.status;
    const refresh = options.refresh;
    if (!canWait) return;
    if (status === 'loading') {
      const token = generation;
      const started = performance.now();
      const timer = setTimeout(() => {
        if (token === generation && frameState.status === 'loading') {
          timeoutRemaining = 0;
          frameState = { ...frameState, status: 'unavailable' };
        }
      }, timeoutRemaining);
      return () => {
        clearTimeout(timer);
        timeoutRemaining = consumeEligibleTime(timeoutRemaining, performance.now() - started);
      };
    }
    if (status === 'ready' && refresh > 0) {
      const token = generation;
      const timer = setTimeout(
        () => {
          if (token === generation && frameState.status === 'ready') startAttempt(attemptUrl);
        },
        refreshRemaining || refresh * 1000,
      );
      return () => {
        clearTimeout(timer);
        refreshRemaining = refresh * 1000;
      };
    }
  });

  function loaded(token: number, key: string) {
    if (token !== generation || key !== frameKey) return;
    frameState = reduceWebFrameDomLoad(frameState, nativeStatus);
  }

  onMount(() => {
    const updateDocument = () => (documentVisible = document.visibilityState === 'visible');
    let stopDashboard = () => {};
    updateDocument();
    document.addEventListener('visibilitychange', updateDocument);
    void watchDashboardVisibility((value) => (dashboardVisible = value))
      .then((stop) => {
        if (disposed) stop();
        else stopDashboard = stop;
      })
      .catch(() => {});
    void subscribeWebFrameEvents((event) => {
      if (disposed || event.frameKey !== frameKey) return;
      frameState = reduceWebFrameState(frameState, event);
    }).then((subscription) => {
      if (disposed) {
        subscription.dispose();
        return;
      }
      nativeStatus = subscription.nativeStatus;
      stopFrames = subscription.dispose;
      observerReady = true;
      if (frameState.domLoaded && !nativeStatus)
        frameState = reduceWebFrameDomLoad(frameState, false);
    });
    return () => {
      disposed = true;
      stopDashboard();
      stopFrames?.();
      document.removeEventListener('visibilitychange', updateDocument);
    };
  });

  onDestroy(() => {
    generation++;
    stopFrames?.();
  });
</script>

<ContentTile
  {control}
  {page}
  {pageId}
  {pageVisible}
  {itemId}
  {pressFeedbackDisabled}
  passThrough={options.interactive && !pressFeedbackDisabled}
>
  {#snippet children()}
    <div
      bind:this={visibilityTarget}
      class="relative h-full w-full overflow-hidden"
    >
      {#if observerReady && pageRendered && attemptUrl}
        {@const token = generation}{@const key = frameKey}
        {#key key}
          <iframe
            name={key}
            title={control.name || 'Web content'}
            src={attemptUrl}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onload={() => loaded(token, key)}
            class="absolute left-0 top-0 border-0"
            class:invisible={frameState.status === 'unavailable'}
            style:width="{10000 / options.zoom}%"
            style:height="{10000 / options.zoom}%"
            style:transform="scale({options.zoom / 100})"
            style:transform-origin="0 0"
          ></iframe>
        {/key}
      {/if}
      {#if frameState.status === 'unavailable'}
        <div
          class="absolute inset-0 grid place-items-center bg-background text-sm text-muted-foreground"
        >
          Unavailable
        </div>
      {/if}
    </div>
  {/snippet}
</ContentTile>

<style>
  iframe {
    transition: opacity 150ms ease;
  }
  iframe.invisible {
    opacity: 0;
  }
</style>

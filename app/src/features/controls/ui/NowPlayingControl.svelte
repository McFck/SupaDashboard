<script
  lang="ts"
  module
>
  import { SvelteMap } from 'svelte/reactivity';

  /**
   * Sleeve ratios of loaded covers by URL, shared by every tile, so a tile mounted by a page switch draws its sleeve
   * at the final size at once instead of resizing when the image loads.
   */
  const coverRatios = new SvelteMap<string, number>();
  // ponytail: whole-cache reset past this many covers; an LRU only if long sessions ever reload covers noticeably.
  const COVER_RATIO_LIMIT = 200;
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { runtimeView } from '../../../app/runtime/state';
  import { candidateKey, progressAt, trackKey } from '../../media/now-playing';
  import { vinylDesign, type VinylDesign } from '../../media/vinyl';
  import { gestures } from '../input/gestures';
  import { pullBindingsFor, type PullSnapshot } from '../input/pull';
  import type { ControlConfig } from '../model';
  import type { Trigger } from '../../automation/scenario';
  import { ControlTile } from './control-tile.svelte';
  import { NowPlayingMotion, watchTileVisibility, type Frame } from './now-playing-control.svelte';
  import PressFeedback from './PressFeedback.svelte';
  import VinylDisc from './VinylDisc.svelte';

  type Progress = { at: number; remainingMs: number };
  type TrackView = {
    title: string;
    artist: string;
    art?: string;
    idle: boolean;
    playing: boolean;
    design: VinylDesign;
    progress: Progress | null;
  };

  let {
    control,
    pageId,
    pageVisible = true,
    itemId,
    pressFeedbackDisabled = false,
  }: {
    control: ControlConfig;
    pageId?: string;
    pageVisible?: boolean;
    itemId?: string;
    pressFeedbackDisabled?: boolean;
  } = $props();
  let root = $state<HTMLElement>();
  let face = $state<HTMLElement>();
  let outgoingFace = $state<HTMLElement>();
  let feedback = $state<PressFeedback>();
  let onScreen = $state(false);
  /** A cover the webview could not decode; the disc stands in for it. */
  let brokenArt = $state<string>();
  const tile = new ControlTile({ control: () => control, itemId: () => itemId });
  const status = $derived($runtimeView.status.widgets[control.id]);
  const candidate = $derived(status?.candidate);
  const visible = $derived(pageVisible && onScreen);

  function progressOf(): Progress | null {
    const session = candidate?.session;
    const timeline = session?.timeline;
    // Read when the sample or visibility changes; the bar then runs on its own until the next sample.
    const at = session ? progressAt(session, Date.now()) : null;
    if (!session || !timeline || at === null) {
      return null;
    }
    const rate = timeline.rate ?? 1;
    const running = visible && session.state === 'playing' && rate > 0 && at < 1;
    return {
      at,
      remainingMs: running ? ((timeline.endMs - timeline.startMs) * (1 - at)) / rate : 0,
    };
  }

  const frame = $derived.by((): Frame<TrackView> => {
    if (!candidate) {
      return {
        key: '',
        session: '',
        view: {
          title: status?.unavailable ? 'Unavailable' : 'Nothing playing',
          artist: '',
          idle: true,
          playing: false,
          design: vinylDesign(),
          progress: null,
        },
      };
    }
    const { title, artist, state } = candidate.session;
    return {
      key: trackKey(candidate),
      session: candidateKey(candidate),
      view: {
        title: title || 'Unknown track',
        artist,
        art: status?.artworkUrl,
        idle: false,
        playing: state === 'playing',
        design: vinylDesign(title, artist),
        progress: progressOf(),
      },
    };
  });
  const label = $derived(
    [control.name || 'Now playing', frame.view.title, frame.view.artist].filter(Boolean).join(', '),
  );
  let shown: Frame<TrackView> | undefined;
  const motion = new NowPlayingMotion<TrackView>({
    face: () => face,
    outgoing: () => outgoingFace,
    shown: () => shown,
  });

  $effect(() => {
    const next = frame;
    untrack(() => {
      void motion.show(shown, next);
      shown = next;
    });
  });
  $effect(() => {
    const node = root;
    if (!node) {
      return;
    }
    return watchTileVisibility(node, (value) => (onScreen = value));
  });

  function onTrigger(_trigger: Trigger, captured?: unknown, snapshot?: PullSnapshot) {
    tile.run(captured, snapshot, motion);
  }

  function fitArtwork(event: Event, url: string) {
    const image = event.currentTarget;
    if (image instanceof HTMLImageElement && image.naturalHeight > 0) {
      const ratio = image.naturalWidth / image.naturalHeight;
      if (coverRatios.size >= COVER_RATIO_LIMIT) {
        coverRatios.clear();
      }
      // Extreme artwork shapes stay contained in the standard sleeve instead of stretching the box.
      coverRatios.set(url, ratio >= 0.8 && ratio <= 1.25 ? ratio : 1.12);
    }
  }
  onDestroy(() => motion.destroy());
</script>

{#snippet track(view: TrackView, live: boolean)}
  <div class="layout">
    <div class="art">
      <div
        class="assembly"
        class:bare={!view.art || view.art === brokenArt}
        style:--cover-ratio={view.art ? coverRatios.get(view.art) : undefined}
      >
        <div class="record">
          <VinylDisc
            design={view.design}
            playing={live && view.playing}
            visible={live && visible}
          />
        </div>
        {#if view.art && view.art !== brokenArt}
          <div
            class="cover"
            class:loading={!coverRatios.has(view.art)}
          >
            <img
              src={view.art}
              alt=""
              draggable="false"
              onload={(event) => fitArtwork(event, view.art ?? '')}
              onerror={() => (brokenArt = view.art)}
            />
          </div>
        {/if}
      </div>
    </div>
    <div class="text tabular-nums">
      <p
        class="title truncate"
        class:idle={view.idle}
      >
        {view.title}
      </p>
      {#if view.artist}
        <p class="artist truncate">{view.artist}</p>
      {/if}
      {#if view.progress}
        {@const progress = view.progress}
        <div class="progress">
          {#key progress}
            <span
              class="fill"
              class:running={progress.remainingMs > 0}
              style:--from={progress.at}
              style:animation-duration="{progress.remainingMs}ms"
            ></span>
          {/key}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

<div
  data-content-tile
  data-page-id={pageId}
  data-page-visible={pageVisible}
  class="relative h-full w-full min-h-0 min-w-0"
>
  <PressFeedback
    bind:this={feedback}
    disabled={pressFeedbackDisabled}
    pulse={false}
    class="tile-content"
  >
    {#snippet children()}
      <div
        bind:this={root}
        class="now-playing"
        aria-hidden="true"
      >
        {#if motion.outgoing}
          <div
            bind:this={outgoingFace}
            class="face"
            inert
          >
            {@render track(motion.outgoing.view, false)}
          </div>
        {/if}
        <div
          bind:this={face}
          class="face"
          style:transform={motion.translate}
        >
          {@render track(frame.view, true)}
        </div>
      </div>
      <button
        type="button"
        aria-label={label}
        disabled={pressFeedbackDisabled}
        use:gestures={{
          onTrigger,
          captureTrigger: tile.capture,
          enabled: !pressFeedbackDisabled,
          pullBindings: () => pullBindingsFor(control, tile.current),
          onStart: motion.beginPull,
          onPull: motion.pull,
          onPullEnd: (pull) => {
            if (pull && !pull.armed) {
              motion.settle(pull);
            }
          },
          onCancel: motion.settle,
          feedback,
        }}
        class="input"
      ></button>
    {/snippet}
  </PressFeedback>
</div>

<style>
  .now-playing {
    position: absolute;
    inset: 0;
    container-type: size;
    background: #171412;
  }
  .face {
    position: absolute;
    inset: 0;
  }
  .layout {
    --pad: clamp(10px, 6cqmin, 18px);
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: clamp(6px, 4cqmin, 14px);
    padding: var(--pad);
  }
  /* Wide tiles put the record on the left and the text beside it. */
  @container (aspect-ratio > 1.6) {
    .layout {
      grid-template-rows: minmax(0, 1fr);
      grid-template-columns: min(58%, calc((100cqh - 2 * var(--pad)) * 1.433)) minmax(0, 1fr);
      align-items: center;
    }
  }
  .art {
    container-type: size;
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  /* A third of the record peeks past the sleeve's right edge. */
  .assembly {
    --cover-ratio: 1.12;
    --assembly-ratio: calc(var(--cover-ratio) + 0.3133);
    position: relative;
    width: min(100cqw, calc(100cqh * var(--assembly-ratio)));
    aspect-ratio: var(--assembly-ratio);
  }
  .record {
    position: absolute;
    top: 3%;
    right: 0;
    height: 94%;
    aspect-ratio: 1;
  }
  .assembly.bare {
    --assembly-ratio: 1;
  }
  .bare .record {
    top: 0;
    height: 100%;
  }
  .cover {
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(100% * var(--cover-ratio) / var(--assembly-ratio));
    overflow: hidden;
    border-radius: 8px;
    background: #0f0d0c;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.5);
  }
  .cover::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    background: linear-gradient(
      135deg,
      rgb(255 255 255 / 20%),
      rgb(255 255 255 / 3%) 35%,
      transparent 50%,
      rgb(255 255 255 / 7%) 75%,
      transparent
    );
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 12%);
  }
  .cover img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    user-select: none;
    transition: opacity 180ms ease-out;
  }
  .cover.loading img {
    opacity: 0;
  }
  .cover.loading {
    animation: cover-loading 1.2s ease-in-out infinite alternate;
  }
  @keyframes cover-loading {
    to {
      background: #1c1917;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cover.loading {
      animation: none;
    }
  }
  .text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .title {
    font-size: clamp(13px, 7cqmin, 20px);
    font-weight: 600;
    line-height: 1.25;
    color: var(--foreground);
  }
  .title.idle {
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .artist {
    font-size: clamp(11px, 5.5cqmin, 16px);
    line-height: 1.3;
    color: var(--muted-foreground);
  }
  .progress {
    position: relative;
    height: 2px;
    margin-top: clamp(4px, 2.5cqmin, 8px);
    overflow: hidden;
    border-radius: 1px;
    background: rgb(255 236 220 / 8%);
  }
  .fill {
    position: absolute;
    inset: 0;
    transform-origin: left;
    transform: scaleX(var(--from));
    background: var(--primary);
  }
  .fill.running {
    animation-name: progress;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
  @keyframes progress {
    from {
      transform: scaleX(var(--from));
    }
    to {
      transform: scaleX(1);
    }
  }
  .input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    opacity: 0;
    touch-action: none;
    -webkit-app-region: no-drag;
  }
</style>

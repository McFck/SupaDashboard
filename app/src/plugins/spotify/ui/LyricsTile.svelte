<script lang="ts">
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { onDestroy } from 'svelte';
  import { Slider } from '$lib/components/ui/slider';
  import Icon from '../../../features/controls/ui/Icon.svelte';
  import type { ControlConfig } from '../../../features/controls/model';
  import { SONG_OFFSET_LIMIT_MS } from '../../../platform/lyrics';
  import { offsetOf } from '../lyric-clock';
  import { LyricsTileController } from './lyrics-tile.svelte';

  let {
    control,
    pageVisible = true,
    pixelWidth = 0,
    pixelHeight = 0,
  }: {
    control: ControlConfig;
    pageVisible?: boolean;
    pixelWidth?: number;
    pixelHeight?: number;
  } = $props();
  const lyrics = new LyricsTileController({
    visible: () => pageVisible,
    offsetMs: () => offsetOf(control.options),
  });
  onDestroy(() => lyrics.destroy());

  const size = $derived(
    Math.round(Math.min(30, Math.max(14, Math.min(pixelWidth * 0.07, pixelHeight * 0.16)))),
  );
  const status = $derived.by(() => {
    switch (lyrics.view.kind) {
      case 'idle':
        return 'Nothing playing';
      case 'none':
        return 'No lyrics';
      case 'instrumental':
        return 'Instrumental';
      default:
        return '';
    }
  });

  const songOffset = $derived(
    `${lyrics.offset.value > 0 ? '+' : ''}${(lyrics.offset.value / 1000).toFixed(1)} s`,
  );

  $effect(() => {
    void [pixelWidth, pixelHeight];
    lyrics.recenter();
  });
</script>

<div
  data-dashboard-tile
  data-lyrics-tile={lyrics.view.kind}
  style="-webkit-app-region: no-drag"
  style:--size="{size}px"
  style:--height="{pixelHeight}px"
  class="tile-content h-full w-full"
>
  {#if lyrics.view.kind === 'synced' || lyrics.view.kind === 'plain'}
    <div
      use:lyrics.scroller
      role="region"
      aria-label="Lyrics"
      class="scroller"
    >
      <div class:synced={lyrics.view.kind === 'synced'}>
        {#if lyrics.view.kind === 'synced'}
          {#each lyrics.view.lines as line, index (index)}
            <p
              class="line"
              class:past={index < lyrics.active}
              class:active={index === lyrics.active}
              aria-current={index === lyrics.active ? 'true' : undefined}
            >
              {line.text.trim() || '♪'}
            </p>
          {/each}
        {:else}
          <p class="plain">
            <span class="mb-2 block text-xs text-zinc-500">[not synced]</span>{lyrics.view.text}
          </p>
        {/if}
      </div>
    </div>
    {#if lyrics.offset.open && lyrics.view.kind === 'synced'}
      <div
        use:lyrics.offset.panel
        role="group"
        aria-label="Song sync offset"
        class="adjust"
      >
        <Slider
          type="single"
          class="min-w-0 flex-1"
          aria-label="Song sync offset"
          value={lyrics.offset.value}
          min={-SONG_OFFSET_LIMIT_MS}
          max={SONG_OFFSET_LIMIT_MS}
          step={100}
          onValueChange={(value) => lyrics.offset.preview(value)}
          onValueCommit={(value) => lyrics.offset.save(value)}
        />
        <span class="value">{songOffset}</span>
        <button
          type="button"
          class="reset"
          aria-label="Reset song sync offset"
          disabled={lyrics.offset.value === 0}
          onclick={() => lyrics.offset.save(0)}
        >
          <RotateCcw size={14} />
        </button>
      </div>
    {/if}
  {:else if lyrics.view.kind === 'loading'}
    <div
      class="loading"
      role="img"
      aria-label="Loading lyrics"
    >
      <span style:width="78%"></span>
      <span style:width="92%"></span>
      <span style:width="58%"></span>
    </div>
  {:else}
    <div class="grid h-full w-full place-items-center">
      <div class="flex flex-col items-center gap-1.5 text-zinc-500">
        <span class="opacity-60">
          <Icon
            name="spotify"
            size={Math.round(Math.min(36, Math.max(22, Math.min(pixelWidth, pixelHeight) * 0.22)))}
          />
        </span>
        <span class="text-xs whitespace-nowrap">{status}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  /* A rounded clip around a scroller makes Chromium scroll it on the main thread. The edge fade already hides the
     corners, so the tile does not clip. */
  [data-lyrics-tile] {
    overflow: visible;
  }
  .scroller {
    position: absolute;
    inset: 0;
    /* Native scrolling runs on the compositor with the platform's inertia, even while the page's script is busy.
       will-change keeps it there: at 1x scale Chromium scrolls a transparent box of subpixel text on the main thread. */
    will-change: scroll-position;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
    scrollbar-width: none;
    user-select: none;
    padding-inline: max(14px, calc(var(--size) * 0.85));
    /* Lines fade in and out at the edges instead of being cut. */
    mask-image: linear-gradient(
      to bottom,
      transparent,
      #000 calc(var(--size) * 1.8),
      #000 calc(100% - var(--size) * 1.8),
      transparent
    );
  }
  /* Room above the first and below the last line, so both can rest at the sung line's height. */
  .synced::before,
  .synced::after {
    content: '';
    display: block;
  }
  .synced::before {
    height: calc(var(--height) * 0.4);
  }
  .synced::after {
    height: calc(var(--height) * 0.6);
  }
  /* Opacity and transform, not colour: both animate on the compositor, while a colour change repaints all lines. */
  .line {
    margin: 0 0 calc(var(--size) * 0.5);
    color: #fff;
    opacity: 0.26;
    font-size: var(--size);
    font-weight: 700;
    line-height: 1.22;
    letter-spacing: -0.012em;
    overflow-wrap: anywhere;
    transform: scale(0.965);
    transform-origin: left center;
    transition:
      opacity 360ms ease,
      transform 480ms cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .past {
    opacity: 0.4;
  }
  .active {
    opacity: 1;
    transform: none;
  }
  .plain {
    margin: 0;
    padding-block: calc(var(--size) * 1.9);
    color: rgb(255 255 255 / 0.78);
    font-size: calc(var(--size) * 0.82);
    font-weight: 600;
    line-height: 1.45;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .adjust {
    position: absolute;
    inset-inline: 8px;
    bottom: 8px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 6px 8px 14px;
    border-radius: 9999px;
    background: rgb(24 24 27 / 0.82);
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.08),
      0 8px 24px rgb(0 0 0 / 0.4);
    backdrop-filter: blur(16px);
    animation: appear 160ms ease both;
  }
  /* A centred scale: the fill from the left end means nothing here, a tick marks 0 instead. */
  .adjust :global([data-slot='slider-range']) {
    display: none;
  }
  .adjust :global([data-slot='slider-track']) {
    background:
      linear-gradient(rgb(255 255 255 / 0.55), rgb(255 255 255 / 0.55)) center / 2px 100% no-repeat,
      rgb(255 255 255 / 0.14);
  }
  .adjust :global([data-slot='slider-thumb']) {
    border-color: transparent;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
  }
  .value {
    min-width: 4.2em;
    color: rgb(255 255 255 / 0.85);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .reset {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 9999px;
    color: rgb(255 255 255 / 0.75);
    transition:
      background-color 150ms ease,
      opacity 150ms ease;
  }
  .reset:hover {
    background: rgb(255 255 255 / 0.08);
  }
  .reset:disabled {
    opacity: 0.3;
  }
  .loading {
    display: grid;
    align-content: center;
    gap: calc(var(--size) * 0.55);
    height: 100%;
    padding-inline: max(14px, calc(var(--size) * 0.85));
    animation: appear 300ms ease 250ms both;
  }
  .loading span {
    height: calc(var(--size) * 0.62);
    border-radius: 9999px;
    background: rgb(255 255 255 / 0.07);
    animation: pulse 1.6s ease-in-out infinite;
  }
  .loading span:nth-child(2) {
    animation-delay: 160ms;
  }
  .loading span:nth-child(3) {
    animation-delay: 320ms;
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .line {
      transition: none;
    }
    .loading,
    .loading span {
      animation: none;
    }
  }
</style>

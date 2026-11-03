<script lang="ts">
  import { settings } from '../../settings/state.svelte';
  import {
    appIconSize,
    buttonIconSize,
    buttonLabelVisible,
    diagonalText,
    LINE_HEIGHT,
  } from '../face-layout';
  import type { ControlFaceProps } from '../model';
  import Icon from './Icon.svelte';

  let { appearance, compact, busy, pixelWidth, pixelHeight }: ControlFaceProps = $props();
  const style = $derived(compact ? undefined : appearance.style);
  const labelScale = $derived(
    !compact && !!appearance.label && buttonLabelVisible(pixelWidth, pixelHeight)
      ? settings.display.labelScale
      : 0,
  );
  const iconSize = $derived(
    buttonIconSize(pixelWidth, pixelHeight, compact, settings.display.iconScale, labelScale),
  );
  // Text-only faces fit their real box, which differs from the grid footprint in editor previews. Words and the
  // space are measured once at 100px in the face's own font.
  const words = $derived(appearance.label?.trim().split(/\s+/).filter(Boolean) ?? []);
  let faceWidth = $state(0),
    faceHeight = $state(0),
    spaceWidth = $state(0),
    wordWidths = $state<number[]>([]);
  const diagonal = $derived(
    diagonalText(
      faceWidth || pixelWidth,
      faceHeight || pixelHeight,
      words.map((_, i) => (wordWidths[i] ?? 0) / 100),
      spaceWidth / 100,
    ),
  );
</script>

{#if style === 'text' && words.length}
  <span
    class="relative grid h-full w-full place-items-center overflow-hidden rounded-[inherit] transition-opacity {busy
      ? 'opacity-60'
      : ''}"
    style:--ink={appearance.color ?? '#f4f4f5'}
    style:background={appearance.background === undefined
      ? undefined
      : (appearance.background ?? 'transparent')}
    bind:clientWidth={faceWidth}
    bind:clientHeight={faceHeight}
  >
    <span
      class="invisible absolute flex text-[100px]"
      aria-hidden="true"
    >
      <span
        class="diagonal"
        bind:offsetWidth={spaceWidth}>&nbsp;</span
      >
      {#each words as word, i (i)}
        <span
          class="diagonal"
          bind:offsetWidth={wordWidths[i]}>{word}</span
        >
      {/each}
    </span>
    <span
      class="ink grid justify-items-center"
      style:font-size="{diagonal.size}px"
      style:line-height={LINE_HEIGHT}
      style:transform="rotate({diagonal.degrees}deg)"
    >
      {#each diagonal.lines as [from, to], line (line)}
        <span class="diagonal">{words.slice(from, to).join(' ')}</span>
      {/each}
    </span>
  </span>
{:else if style === 'app'}
  <span
    class="grid h-full w-full place-items-center rounded-[inherit] p-3"
    style:color={appearance.color ?? undefined}
    style:background={appearance.background === undefined
      ? undefined
      : (appearance.background ?? 'transparent')}
  >
    <span class="app-icon grid place-items-center transition-opacity {busy ? 'opacity-60' : ''}">
      <Icon
        name={appearance.icon ?? 'AppWindow'}
        app={appearance.app}
        size={appIconSize(pixelWidth, pixelHeight, settings.display.iconScale)}
      />
    </span>
  </span>
{:else}
  <span
    class="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[inherit] p-3"
    style:color={appearance.color ?? undefined}
    style:background={appearance.background === undefined
      ? undefined
      : (appearance.background ?? 'transparent')}
  >
    <span class="transition-opacity {busy ? 'opacity-60' : ''}">
      <Icon
        name={appearance.icon ?? undefined}
        size={iconSize}
        fallback=""
      />
    </span>
    {#if !compact && appearance.label}
      <span
        class="max-w-[90%] truncate text-xs font-semibold tracking-wide text-zinc-100"
        style:font-size="{12 * settings.display.labelScale}px"
        style:line-height="{16 * settings.display.labelScale}px">{appearance.label}</span
      >
    {/if}
  </span>
{/if}

<style>
  .diagonal {
    font-family: var(--font-display);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  /* Ink fades from the state colour into the tile accent, with a soft lift off the surface. */
  .ink {
    background: linear-gradient(
      135deg,
      var(--ink) 35%,
      color-mix(in oklab, var(--ink) 55%, var(--accent, #8ea8f0))
    );
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 2px 6px rgb(0 0 0 / 0.45));
  }
</style>

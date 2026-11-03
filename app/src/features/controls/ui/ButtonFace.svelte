<script lang="ts">
  import { settings } from '../../settings/state.svelte';
  import { appBadgeSize, buttonIconSize, buttonLabelVisible, diagonalLabel } from '../face-layout';
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
  const badgeSize = $derived(
    appBadgeSize(pixelWidth, pixelHeight, settings.display.iconScale, labelScale),
  );
  // Text-only faces fit their real box, which differs from the grid footprint in editor previews.
  let faceWidth = $state(0),
    faceHeight = $state(0),
    inkWidth = $state(0);
  const diagonal = $derived(
    diagonalLabel(faceWidth || pixelWidth, faceHeight || pixelHeight, inkWidth / 100),
  );
</script>

{#snippet label()}
  <span
    class="max-w-[90%] truncate text-xs font-semibold tracking-wide text-zinc-100"
    style:font-size="{12 * settings.display.labelScale}px"
    style:line-height="{16 * settings.display.labelScale}px">{appearance.label}</span
  >
{/snippet}

{#if style === 'text' && appearance.label}
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
      class="diagonal invisible absolute text-[100px]"
      aria-hidden="true"
      bind:offsetWidth={inkWidth}>{appearance.label}</span
    >
    <span
      class="diagonal ink"
      style:font-size="{diagonal.size}px"
      style:transform="rotate({diagonal.degrees}deg)">{appearance.label}</span
    >
  </span>
{:else if style === 'app'}
  <span
    class="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[inherit] p-3"
    style:background={appearance.background === undefined
      ? undefined
      : (appearance.background ?? 'transparent')}
  >
    <span
      class="badge grid shrink-0 place-items-center text-white transition-opacity {busy
        ? 'opacity-60'
        : ''}"
      style:width="{badgeSize}px"
      style:height="{badgeSize}px"
    >
      <Icon
        name={appearance.icon ?? 'AppWindow'}
        size={badgeSize * 0.56}
      />
    </span>
    {#if labelScale}{@render label()}{/if}
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
    {#if !compact && appearance.label}{@render label()}{/if}
  </span>
{/if}

<style>
  .diagonal {
    font-family: var(--font-display);
    font-weight: 700;
    line-height: 1;
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
  /* A rounded app badge lit from above in the tile accent. */
  .badge {
    border-radius: 26%;
    background:
      linear-gradient(180deg, rgb(255 255 255 / 0.22), transparent 55%),
      linear-gradient(
        160deg,
        color-mix(in oklab, var(--accent, #8ea8f0) 85%, white),
        color-mix(in oklab, var(--accent, #8ea8f0) 70%, black)
      );
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.3),
      inset 0 -1px 0 rgb(0 0 0 / 0.25),
      0 10px 24px -10px rgb(0 0 0 / 0.75),
      0 2px 6px rgb(0 0 0 / 0.3);
  }
</style>

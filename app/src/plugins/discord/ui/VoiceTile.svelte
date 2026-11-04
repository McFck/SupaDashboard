<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from '../../../features/controls/ui/Icon.svelte';
  import type { VoiceMember } from '../../../platform/discord';
  import { pack } from '../pack';
  import { VoiceTileController } from './voice-tile.svelte';

  let { pixelWidth = 0, pixelHeight = 0 }: { pixelWidth?: number; pixelHeight?: number } = $props();
  const voice = new VoiceTileController();
  onDestroy(() => voice.destroy());

  const short = $derived(Math.min(pixelWidth, pixelHeight));
  const pad = $derived(Math.round(Math.min(14, Math.max(8, short * 0.09))));
  const gap = $derived(Math.round(Math.min(8, Math.max(4, short * 0.035))));
  const members = $derived(voice.view.state === 'inVoice' ? voice.view.members : []);
  const grid = $derived(pack(members.length, pixelWidth - 2 * pad, pixelHeight - 2 * pad, gap));
  const shown = $derived(grid.overflow ? members.slice(0, grid.cols * grid.rows - 1) : members);
  const status = $derived.by(() => {
    switch (voice.view.state) {
      case 'absent':
        return 'Discord not running';
      case 'connecting':
        return 'Connecting';
      case 'idle':
        return 'Not in voice';
      case 'inVoice':
        return members.length ? '' : 'Empty channel';
      default:
        return 'Not connected';
    }
  });

  const describe = (member: VoiceMember) =>
    [
      member.name,
      member.speaking && 'speaking',
      member.deafened ? 'deafened' : member.muted && 'muted',
    ]
      .filter(Boolean)
      .join(', ');
</script>

<div
  data-dashboard-tile
  data-voice-tile
  class="tile-content grid h-full w-full place-items-center"
>
  {#if status}
    {@const compact = pixelWidth < 150}
    <div
      class="flex flex-col items-center gap-2 text-zinc-500"
      role={compact ? 'img' : undefined}
      aria-label={compact ? status : undefined}
    >
      <span class="opacity-60">
        <Icon
          name="discord-voice"
          size={Math.round(Math.min(36, Math.max(22, short * 0.22)))}
        />
      </span>
      {#if !compact}
        <span class="text-xs">{status}</span>
      {/if}
    </div>
  {:else}
    <div
      role="group"
      aria-label={voice.view.state === 'inVoice' ? voice.view.channel.name : undefined}
      class="flex flex-wrap content-center justify-center"
      style:width="{grid.cols * grid.size + (grid.cols - 1) * gap}px"
      style:gap="{gap}px"
      style:--size="{grid.size}px"
    >
      {#each shown as member (member.id)}
        {@const src = voice.src(member)}
        <div
          role="img"
          aria-label={describe(member)}
          data-member={member.id}
          class="avatar"
          class:speaking={member.speaking}
          class:quiet={member.muted || member.deafened}
        >
          <span
            class="ring"
            aria-hidden="true"
          ></span>
          {#if src}
            <img
              {src}
              alt=""
              draggable="false"
              onerror={() => voice.fail(src)}
            />
          {:else}
            <span class="face initial">{[...member.name][0]?.toUpperCase()}</span>
          {/if}
        </div>
      {/each}
      {#if grid.overflow}
        <div
          role="img"
          aria-label="{grid.overflow} more"
          class="avatar"
        >
          <span class="face more">+{grid.overflow}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .avatar {
    --ring: clamp(2px, calc(var(--size) * 0.032), 3.5px);
    --inset: calc(var(--ring) + max(1.5px, calc(var(--size) * 0.03)));
    position: relative;
    flex: none;
    width: var(--size);
    height: var(--size);
  }
  /* The ring sits inside the cell's reserved inset, so speaking never moves or resizes anything. */
  .ring {
    position: absolute;
    inset: 0;
    border-radius: 9999px;
    box-shadow:
      inset 0 0 0 var(--ring) #2dc770,
      0 0 calc(var(--size) * 0.12) rgb(45 199 112 / 0.3);
    opacity: 0;
    transition: opacity 120ms ease-out;
  }
  .speaking .ring {
    opacity: 1;
  }
  img,
  .face {
    position: absolute;
    inset: var(--inset);
    border-radius: 9999px;
    background: #2b2d33;
    box-shadow:
      0 0 0 1px rgb(255 255 255 / 0.06),
      0 1px 3px rgb(0 0 0 / 0.35);
    transition:
      opacity 160ms ease-out,
      filter 160ms ease-out;
  }
  img {
    width: calc(100% - 2 * var(--inset));
    height: calc(100% - 2 * var(--inset));
    object-fit: cover;
    user-select: none;
  }
  .face {
    display: grid;
    place-items: center;
    color: #d4d6dc;
    font-size: calc(var(--size) * 0.36);
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .more {
    background: rgb(255 255 255 / 0.07);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
    color: #a1a4ad;
    font-size: calc(var(--size) * 0.3);
  }
  .quiet img,
  .quiet .face {
    opacity: 0.4;
    filter: saturate(0.4);
  }
  @media (prefers-reduced-motion: reduce) {
    .ring,
    img,
    .face {
      transition: none;
    }
  }
</style>

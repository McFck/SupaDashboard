<script lang="ts">
  import { buttonIconSize } from '../face-layout';
  import type { ControlFaceProps } from '../model';
  import Icon from './Icon.svelte';

  let { appearance, compact, busy, pixelWidth, pixelHeight }: ControlFaceProps = $props();
  const iconSize = $derived(buttonIconSize(pixelWidth, pixelHeight, compact));
</script>

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
    <span class="max-w-[90%] truncate text-xs font-semibold tracking-wide text-zinc-100"
      >{appearance.label}</span
    >
  {/if}
</span>

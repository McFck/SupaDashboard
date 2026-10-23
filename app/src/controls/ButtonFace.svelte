<script lang="ts">
  import type { TileAppearance } from '../core/controls';
  import Icon from './Icon.svelte';

  let { view, iconSize, compact = false, busy = false }: {
    view: TileAppearance; iconSize: number; compact?: boolean; busy?: boolean;
  } = $props();
</script>

<span class="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[inherit] p-3"
  style:color={view.color ?? undefined} style:background={view.background === undefined ? undefined : view.background ?? 'transparent'}>
  <span class="transition-opacity {busy ? 'opacity-60' : ''}">
    <Icon name={view.icon ?? undefined} size={iconSize} fallback="" />
  </span>
  {#if !compact && view.label}
    <span class="max-w-[90%] truncate text-xs font-semibold tracking-wide text-zinc-100">{view.label}</span>
  {/if}
</span>

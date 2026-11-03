<script lang="ts">
  import type { TileAppearance } from '../model';
  import Icon from '../ui/Icon.svelte';

  let { appearance }: { appearance: TileAppearance } = $props();
</script>

<span
  aria-hidden="true"
  class="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted"
  style:color={appearance.color ?? '#8ea8f0'}
  style:background={appearance.background ?? undefined}
>
  {#if appearance.icon || appearance.app}
    <Icon
      name={appearance.icon ?? undefined}
      app={appearance.style === 'app' ? appearance.app : undefined}
      size={16}
    />
  {:else}
    <span class="size-2 rounded-full bg-current"></span>
  {/if}
</span>

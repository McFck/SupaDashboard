<script lang="ts">
  import BadgeCheck from '@lucide/svelte/icons/badge-check';
  import type { NativePlugin } from '../external/load';
  let { trust, class: className = '' }: { trust: NativePlugin['trust']; class?: string } = $props();
</script>

<span class="inline-flex items-center gap-1 font-semibold {className}">
  {#if trust === 'dev'}
    Dev
  {:else if trust === 'verified'}
    SupaDashboard<BadgeCheck
      class="size-3.5 shrink-0 text-primary"
      role="img"
      aria-label="Verified"
    />
  {:else}
    Unverified
  {/if}
</span>

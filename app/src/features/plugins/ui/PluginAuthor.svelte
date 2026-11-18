<script lang="ts">
  import BadgeCheck from '@lucide/svelte/icons/badge-check';
  let { verified, class: className = '' }: { verified: boolean; class?: string } = $props();
</script>

<span class="inline-flex items-center gap-1 font-semibold {className}">
  {#if verified}
    SupaDashboard<BadgeCheck
      class="size-3.5 shrink-0 text-primary"
      role="img"
      aria-label="Verified"
    />
  {:else}
    Unverified
  {/if}
</span>

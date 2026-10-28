<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, children }: { title?: string; children: Snippet } = $props();
</script>

<section class="grid">
  {#if title}<h3 class="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
    </h3>{/if}
  {@render children()}
</section>

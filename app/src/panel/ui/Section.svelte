<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, children }: { title?: string; children: Snippet } = $props();
</script>

<section class="grid">
  {#if title}<h3 class="section-label pb-2">{title}</h3>{/if}
  {@render children()}
</section>

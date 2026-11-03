<script lang="ts">
  import { cn } from '$lib/utils';
  let { class: className }: { class?: string } = $props();
</script>

<div
  data-slot="skeleton"
  aria-hidden="true"
  class={cn('animate-pulse rounded-md bg-muted', className)}
></div>

<script lang="ts">
  // shadcn Kbd: one key cap. Use several side by side for a chord.
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  let { class: className, children }: { class?: string; children: Snippet } = $props();
</script>

<kbd data-slot="kbd" class={cn('pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground', className)}>
  {@render children()}
</kbd>

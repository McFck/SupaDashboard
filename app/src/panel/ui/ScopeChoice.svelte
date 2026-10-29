<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';

  let {
    all,
    count,
    label,
    onchange,
    children,
  }: {
    all: boolean;
    /** Chosen items, shown beside "Selected". */
    count?: number;
    label: string;
    onchange: (all: boolean) => void;
    children: Snippet;
  } = $props();
</script>

<div class="grid gap-3">
  <ToggleGroup.Root
    type="single"
    variant="outline"
    class="w-full"
    aria-label={label}
    value={all ? 'all' : 'selected'}
    onValueChange={(value) => value && onchange(value === 'all')}
  >
    <ToggleGroup.Item
      value="all"
      class="flex-1">All</ToggleGroup.Item
    >
    <ToggleGroup.Item
      value="selected"
      class="flex-1"
      >Selected{#if !all && count}<span class="ml-1.5 text-muted-foreground tabular-nums"
          >{count}</span
        >{/if}</ToggleGroup.Item
    >
  </ToggleGroup.Root>
  {#if !all}
    {@render children()}
  {/if}
</div>

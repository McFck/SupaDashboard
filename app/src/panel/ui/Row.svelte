<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    label,
    for: id,
    wide = false,
    children,
  }: { label: string; for?: string; wide?: boolean; children: Snippet } = $props();
</script>

<div
  class="flex min-w-0 border-b border-border py-3.5 last:border-b-0 {wide
    ? 'flex-col gap-3'
    : 'items-center gap-4'}"
>
  <label
    for={id}
    class="min-w-0 flex-1 text-[15px] font-medium">{label}</label
  >
  <div class={wide ? 'min-w-0' : 'flex min-w-0 max-w-[70%] shrink justify-end'}>
    {@render children()}
  </div>
</div>

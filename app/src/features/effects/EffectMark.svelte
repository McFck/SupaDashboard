<script lang="ts">
  // The one "effect set" mark; per-effect glyphs stay inside the picker grid.
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { cn } from '$lib/utils';

  let { class: className }: { class?: string } = $props();
</script>

<span
  class={cn(
    'grid size-5 shrink-0 place-items-center rounded-full bg-gradient-to-b from-amber-200/25 to-amber-500/10 text-amber-200 ring-1 ring-amber-200/35 ring-inset',
    className,
  )}
>
  <Sparkles
    class="size-[60%]"
    strokeWidth={2.25}
  />
</span>

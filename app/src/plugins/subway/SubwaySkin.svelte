<script lang="ts">
  // Placeholder screen; the authentic in-car LCD replaces <main> next. The bottom bar reuses the deck's controls.
  import { controlTypes } from '../../core/registry';
  import { controlById, type Page } from '../../core/settings.svelte';
  import Clock from '../../widgets/Clock.svelte';

  let { page }: { page: Page } = $props();
  const strip = $derived([...page.items].sort((a, b) => a.y - b.y || a.x - b.x)
    .map(i => controlById(i.control)).filter(c => c && (c.type === 'button' || c.type === 'slider')));
</script>

<div class="grid h-full grid-rows-[1fr_48px] bg-[#0c0f12] text-[#e9eef2]">
  <main class="grid grid-rows-[10px_1fr]">
    <div class="bg-[#9acd32]"></div>
    <div class="grid place-content-center text-5xl"><Clock /></div>
  </main>
  <nav class="flex justify-center gap-1 border-t border-border bg-sidebar px-4 py-1">
    {#each strip as control (control!.id)}
      {@const def = controlTypes.get(control!.type)}
      {#if def}<def.component control={control!} {page} itemId={page.items.find(item => item.control === control!.id)?.id} compact />{/if}
    {/each}
  </nav>
</div>

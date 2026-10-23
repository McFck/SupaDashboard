<script lang="ts">
  // Palette bubbles, a picker bubble for any colour, and an opacity slider. Value: "#rrggbb" or "#rrggbbaa".
  import Pipette from '@lucide/svelte/icons/pipette';
  import { Slider } from '$lib/components/ui/slider';
  import { ACCENTS, splitAlpha, withAlpha } from '../core/palette';

  let { value, onchange, palette = ACCENTS }: { value: string; onchange: (v: string) => void; palette?: string[] } = $props();
  const parts = $derived(splitAlpha(value));
  const custom = $derived(!palette.includes(parts.hex));
  let picker = $state<HTMLInputElement>();
</script>

<div class="grid gap-3">
  <div class="flex flex-wrap items-center gap-2">
    {#each palette as c (c)}
      <button type="button" aria-label={c} onclick={() => onchange(withAlpha(c, parts.alpha))} style:background={c}
        class="size-7 rounded-full border border-white/15 transition {parts.hex === c ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-950' : 'opacity-85 hover:opacity-100'}"></button>
    {/each}
    <button type="button" aria-label="Custom colour" onclick={() => picker?.click()}
      style:background={custom ? parts.hex : undefined}
      class="grid size-7 place-items-center rounded-full bg-secondary text-white transition {custom ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-950' : ''}">
      <Pipette size={14} />
    </button>
    <input bind:this={picker} type="color" class="sr-only" tabindex="-1" aria-hidden="true" value={parts.hex}
      oninput={e => onchange(withAlpha(e.currentTarget.value, parts.alpha))} />
  </div>
  <div class="flex items-center gap-3">
    <Slider type="single" class="flex-1" value={Math.round(parts.alpha * 100)} min={0} max={100} step={1}
      onValueChange={v => onchange(withAlpha(parts.hex, v / 100))} />
    <span class="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(parts.alpha * 100)}%</span>
  </div>
</div>

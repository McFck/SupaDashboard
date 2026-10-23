<script lang="ts" module>
  import { icons } from '@lucide/svelte';
  import { customIcons } from '../core/registry';
  /** Every Lucide icon name plus plugin icons, for the picker. */
  export const iconNames = () => [...Object.keys(icons), ...customIcons.keys()].sort();
</script>

<script lang="ts">
  let { name, size = 24, fallback = '' }: { name?: string; size?: number; fallback?: string } = $props();
  const Lucide = $derived(name ? (icons as Record<string, any>)[name] : undefined);
  const custom = $derived(name ? customIcons.get(name) : undefined);
</script>

{#if Lucide}
  <Lucide {size} strokeWidth={1.75} />
{:else if custom}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={custom} /></svg>
{:else}
  <span class="font-semibold" style:font-size="{Math.max(10, size * 0.55)}px">{fallback}</span>
{/if}

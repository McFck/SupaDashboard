<script lang="ts" module>
  import { bundledPlugins, plugins } from '../core/registry';

  export function pluginTitle(id?: string) {
    if (!id || id === 'user') return undefined;
    const provider = plugins.find(plugin => plugin.id === id) ?? bundledPlugins.find(plugin => plugin.id === id);
    if (!provider || provider.builtin) return undefined;
    return provider.title || id;
  }
</script>

<script lang="ts">
  import Wrench from '@lucide/svelte/icons/wrench';
  import { Hint } from '$lib/components/ui/tooltip';

  let { plugin }: { plugin?: string } = $props();
  const title = $derived(pluginTitle(plugin));
</script>

{#if title}
  <span class="sr-only">Plugin · {title}</span>
  <Hint text="Plugin · {title}">
    {#snippet children(props)}
      <span {...props} tabindex="-1" aria-hidden="true" class="inline-flex h-3 w-3 shrink-0 items-center justify-center text-muted-foreground">
        <Wrench size={12} strokeWidth={1.75} />
      </span>
    {/snippet}
  </Hint>
{/if}

<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import Icon from '../../controls/ui/Icon.svelte';
  import { bundledPlugins, plugins, setPluginEnabled } from '../registry';
  import Section from '../../../panel/ui/Section.svelte';

  let { onopen }: { onopen: (id: string) => void } = $props();
  let installing = $state<string | null>(null);
  const entries = bundledPlugins.filter((p) => !p.builtin && !p.private);
  async function install(id: string) {
    installing = id;
    try {
      await setPluginEnabled(id, true);
    } catch (error) {
      console.error(error);
      toast.error('Could not install plugin');
      installing = null;
    }
  }
</script>

<div class="mx-auto grid max-w-[960px] gap-10 px-6 py-9">
  <h1 class="font-display text-xl font-semibold tracking-wide">Market</h1>
  <Section>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-3">
      {#each entries as entry (entry.id)}
        {@const installed = plugins.some((p) => p.id === entry.id)}
        <article
          class="flex min-w-0 flex-col items-start gap-3 rounded-xl bg-white/[.03] p-4 transition-colors hover:bg-white/[.05]"
        >
          <span class="grid size-10 place-items-center rounded-lg bg-accent"
            ><Icon
              name={entry.icon ?? 'Puzzle'}
              size={22}
            /></span
          >
          <div class="grid gap-0.5">
            <h2 class="text-sm font-semibold">{entry.title}</h2>
            <p class="text-xs text-muted-foreground">{entry.author ?? ''}</p>
          </div>
          {#if entry.description}
            <p class="line-clamp-2 text-xs text-muted-foreground">{entry.description}</p>
          {/if}
          {#if installed}
            <Button
              class="mt-auto w-full"
              size="sm"
              variant="secondary"
              onclick={() => onopen(entry.id)}>Open</Button
            >
          {:else}
            <Button
              class="mt-auto w-full"
              size="sm"
              disabled={installing !== null}
              onclick={() => install(entry.id)}>Install</Button
            >
          {/if}
        </article>
      {/each}
    </div>
  </Section>
</div>

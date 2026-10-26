<script lang="ts">
  import Icon from '../../controls/ui/Icon.svelte';
  import { plugins } from '../registry';
  import Section from '../../../panel/ui/Section.svelte';
  import PluginPage from './PluginPage.svelte';
  const packages = plugins.filter((p) => !p.builtin);
  let selected = $state<string | null>(null);
  const plugin = $derived(packages.find((p) => p.id === selected));
</script>

{#if plugin}<PluginPage
    {plugin}
    onback={() => (selected = null)}
  />{:else}
  <div class="mx-auto grid max-w-[740px] gap-10 px-6 py-9">
    <h1 class="text-xl font-semibold tracking-tight">Plugins</h1>
    <Section title="Installed">
      <div class="grid gap-2">
        {#each packages as p (p.id)}
          <button
            type="button"
            onclick={() => (selected = p.id)}
            class="flex items-center gap-4 rounded-xl border bg-white/[.025] p-4 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-white/[.06]"
              ><Icon
                name={p.icon ?? 'Puzzle'}
                size={20}
              /></span
            >
            <div class="min-w-0">
              <p class="text-[15px] font-medium">{p.title}</p>
            </div>
          </button>
        {/each}
      </div>
    </Section>
  </div>
{/if}

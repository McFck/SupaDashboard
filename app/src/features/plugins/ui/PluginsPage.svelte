<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { Switch } from '$lib/components/ui/switch';
  import Icon from '../../controls/ui/Icon.svelte';
  import { bundledPlugins, pluginState, setPluginEnabled } from '../registry';
  import Section from '../../../panel/ui/Section.svelte';
  import PluginPage from './PluginPage.svelte';
  let { selected = $bindable(null) }: { selected: string | null } = $props();
  const packages = bundledPlugins.filter((p) => !p.builtin);
  let changing = $state(false);
  const plugin = $derived(packages.find((p) => p.id === selected));

  async function setEnabled(id: string, enabled: boolean) {
    if (changing) {
      return;
    }
    changing = true;
    try {
      await setPluginEnabled(id, enabled);
    } catch (error) {
      console.error(error);
      toast.error('Could not change plugin state');
    } finally {
      changing = false;
    }
  }
</script>

{#if plugin}
  <PluginPage
    {plugin}
    onback={() => (selected = null)}
  />
{:else}
  <div class="mx-auto grid max-w-[740px] grid-cols-1 gap-10 px-6 py-9">
    <h1 class="font-display text-xl font-semibold tracking-wide">Plugins</h1>
    <Section title="Installed">
      <div class="grid grid-cols-1 gap-2">
        {#each packages as p (p.id)}
          <div class="flex items-center gap-4 rounded-xl bg-white/[.03] pr-4">
            <button
              type="button"
              onclick={() => (selected = p.id)}
              class="flex min-w-0 flex-1 items-center gap-4 rounded-xl p-4 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-white/[.06]"
                ><Icon
                  name={p.icon ?? 'Puzzle'}
                  size={20}
                /></span
              >
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-3">
                  <p class="truncate text-base font-medium">{p.title}</p>
                  {#if p.author}
                    <span class="shrink-0 text-xs text-muted-foreground">{p.author}</span>
                  {/if}
                  {#if p.version}
                    <span class="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
                      >{p.version}</span
                    >
                  {/if}
                </div>
                {#if p.description}
                  <p class="truncate text-xs text-muted-foreground">{p.description}</p>
                {/if}
              </div>
            </button>
            <Switch
              aria-label={`Enable ${p.title}`}
              checked={p.default || !$pluginState.uninstalled.includes(p.id)}
              disabled={p.default || changing}
              onCheckedChange={(enabled) => setEnabled(p.id, enabled)}
            />
          </div>
        {/each}
      </div>
    </Section>
  </div>
{/if}

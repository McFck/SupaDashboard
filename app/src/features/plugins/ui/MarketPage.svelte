<script lang="ts">
  import FileUp from '@lucide/svelte/icons/file-up';
  import { isTauri } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import Icon, { iconOr } from '../../controls/ui/Icon.svelte';
  import { installPluginFromFile } from '../file-install';
  import { catalogEntries, type CatalogEntry } from '../plugin-store';
  import { compiledPlugins, nativePlugins, pluginsInstalled } from '../registry';
  import { installPlugin, pluginCatalogue } from '../../../platform/plugin-host';
  import Section from '../../../panel/ui/Section.svelte';
  import MarketDetails from './MarketDetails.svelte';
  import PluginAuthor from './PluginAuthor.svelte';

  let { onopen }: { onopen: (id: string) => void } = $props();
  let entries = $state<CatalogEntry[]>([]);
  let selected = $state<string | null>(null);
  /** Set while an install runs; a successful one reloads the window, so it stays set. */
  let busy = $state(false);
  const details = $derived(entries.find((entry) => entry.id === selected));

  $effect(() => {
    if (!isTauri()) {
      return;
    }
    const abort = new AbortController();
    pluginCatalogue()
      .then((raw) => {
        if (!abort.signal.aborted) {
          entries = catalogEntries(raw);
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted) {
          console.error(error);
          toast.error('Could not load catalog');
        }
      });
    return () => abort.abort();
  });

  /** Compiled plugins update with the app; a listed one with another version can update. */
  function actionOf(entry: CatalogEntry) {
    const listed = nativePlugins.get(entry.id);
    if (compiledPlugins.has(entry.id) || listed?.version === entry.version) {
      return 'Open';
    }
    return listed ? 'Update' : 'Install';
  }

  /** `job` returns the installed id, or null when the user stopped it. */
  async function installing(job: () => Promise<string | null>, failure: string) {
    if (busy) {
      return;
    }
    busy = true;
    try {
      const id = await job();
      if (id === null) {
        busy = false;
        return;
      }
      await pluginsInstalled([id]);
    } catch (error) {
      console.error(error);
      toast.error(failure);
      busy = false;
    }
  }

  function run(entry: CatalogEntry) {
    const action = actionOf(entry);
    if (action === 'Open') {
      onopen(entry.id);
      return;
    }
    void installing(async () => {
      await installPlugin(entry.id);
      return entry.id;
    }, `Could not ${action.toLowerCase()} ${entry.title}`);
  }

  function installFile() {
    void installing(async () => {
      const path = await open({
        filters: [{ name: 'SupaDashboard plugin', extensions: ['sdplugin'] }],
      });
      return typeof path === 'string' ? installPluginFromFile(path) : null;
    }, 'Could not install plugin');
  }
</script>

{#snippet action(entry: CatalogEntry, className: string)}
  {@const label = actionOf(entry)}
  <Button
    class={className}
    size="sm"
    variant={label === 'Open' ? 'secondary' : 'default'}
    disabled={label !== 'Open' && busy}
    onclick={() => run(entry)}>{label}</Button
  >
{/snippet}

{#if details}
  <MarketDetails
    entry={details}
    onback={() => (selected = null)}
  >
    {@render action(details, '')}
  </MarketDetails>
{:else}
  <div class="mx-auto grid max-w-[960px] gap-10 px-6 py-9">
    <div class="flex items-center justify-between gap-4">
      <h1 class="font-display text-xl font-semibold tracking-wide">Market</h1>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onclick={installFile}><FileUp />Install from file</Button
      >
    </div>
    <Section>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-3">
        {#each entries as entry (entry.id)}
          <article
            class="flex min-w-0 flex-col items-start gap-3 rounded-xl bg-white/[.03] p-4 transition-colors hover:bg-white/[.05]"
          >
            <button
              type="button"
              class="grid w-full justify-items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onclick={() => (selected = entry.id)}
            >
              <span class="grid size-10 place-items-center rounded-lg bg-accent"
                ><Icon
                  name={iconOr(entry.icon, 'Puzzle')}
                  size={22}
                /></span
              >
              <span class="grid gap-0.5">
                <span class="text-sm font-semibold">{entry.title}</span>
                <PluginAuthor
                  class="text-xs text-muted-foreground"
                  verified
                />
              </span>
              {#if entry.description}
                <span class="line-clamp-2 text-xs text-muted-foreground">{entry.description}</span>
              {/if}
            </button>
            {@render action(entry, 'mt-auto w-full')}
          </article>
        {/each}
      </div>
    </Section>
  </div>
{/if}

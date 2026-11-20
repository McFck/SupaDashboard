<script lang="ts">
  import FileUp from '@lucide/svelte/icons/file-up';
  import { isTauri } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import Skeleton from '$lib/components/ui/skeleton/Skeleton.svelte';
  import Icon, { iconOr } from '../../controls/ui/Icon.svelte';
  import { installPluginFromFile } from '../file-install';
  import { reviewPluginPermissions } from '../permission-consent';
  import { catalogEntries, type CatalogEntry } from '../plugin-store';
  import { compiledPlugins, nativePlugins, pluginsInstalled } from '../registry';
  import { installPlugin, pluginCatalogue } from '../../../platform/plugin-host';
  import Section from '../../../panel/ui/Section.svelte';
  import MarketDetails from './MarketDetails.svelte';
  import PluginAuthor from './PluginAuthor.svelte';

  let { onopen }: { onopen: (id: string) => void } = $props();
  type Catalogue =
    { kind: 'loading' } | { kind: 'ready'; entries: CatalogEntry[] } | { kind: 'failed' };
  let catalogue = $state<Catalogue>({ kind: 'loading' });
  /** Bumped by Retry to fetch the catalogue again. */
  let attempt = $state(0);
  let selected = $state<string | null>(null);
  /** Set while an install runs; a successful one reloads the window, so it stays set. */
  let busy = $state(false);
  const details = $derived(
    catalogue.kind === 'ready'
      ? catalogue.entries.find((entry) => entry.id === selected)
      : undefined,
  );

  $effect(() => {
    void attempt;
    if (!isTauri()) {
      catalogue = { kind: 'ready', entries: [] };
      return;
    }
    catalogue = { kind: 'loading' };
    const abort = new AbortController();
    pluginCatalogue()
      .then((raw) => {
        if (!abort.signal.aborted) {
          catalogue = { kind: 'ready', entries: catalogEntries(raw) };
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted) {
          console.error(error);
          catalogue = { kind: 'failed' };
        }
      });
    return () => abort.abort();
  });

  /** Compiled plugins update with the app; a listed one with another version can update. */
  function actionOf(entry: CatalogEntry) {
    const listed = nativePlugins.get(entry.id);
    if (
      compiledPlugins.has(entry.id) ||
      listed?.trust === 'dev' ||
      listed?.version === entry.version
    ) {
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
      const listed = nativePlugins.get(entry.id);
      if (listed?.consent) {
        void reviewPluginPermissions(listed);
      } else {
        onopen(entry.id);
      }
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
      {#if catalogue.kind === 'loading'}
        <!-- Shown only after 150 ms, so a quick answer never flashes it. -->
        <div
          class="grid animate-in grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-3 fade-in fill-mode-backwards delay-150"
        >
          {#each { length: 6 }, index (index)}
            <div class="flex flex-col items-start gap-3 rounded-xl bg-white/[.03] p-4">
              <Skeleton class="size-10 rounded-lg" />
              <span class="grid gap-0.5">
                <Skeleton class="h-5 w-24" />
                <Skeleton class="h-4 w-16" />
              </span>
              <Skeleton class="h-8 w-full" />
              <Skeleton class="mt-auto h-7 w-full" />
            </div>
          {/each}
        </div>
      {:else if catalogue.kind === 'failed'}
        <div class="grid justify-items-center gap-3 py-10">
          <p class="text-sm font-semibold">Could not load catalog</p>
          <Button
            variant="outline"
            size="sm"
            onclick={() => attempt++}>Retry</Button
          >
        </div>
      {:else}
        <div
          class="grid animate-in grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-3 fade-in"
        >
          {#each catalogue.entries as entry (entry.id)}
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
                    trust={nativePlugins.get(entry.id)?.trust === 'dev' ? 'dev' : 'verified'}
                  />
                </span>
                {#if entry.description}
                  <span class="line-clamp-2 text-xs text-muted-foreground">{entry.description}</span
                  >
                {/if}
              </button>
              {@render action(entry, 'mt-auto w-full')}
            </article>
          {/each}
        </div>
      {/if}
    </Section>
  </div>
{/if}

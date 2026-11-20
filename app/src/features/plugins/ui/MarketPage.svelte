<script lang="ts">
  import FileUp from '@lucide/svelte/icons/file-up';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import { open } from '@tauri-apps/plugin-dialog';
  import { tick } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { Hint } from '$lib/components/ui/tooltip';
  import Icon, { iconOr } from '../../controls/ui/Icon.svelte';
  import { installPluginFromFile } from '../file-install';
  import { reviewPluginPermissions } from '../permission-consent';
  import type { CatalogEntry } from '../plugin-store';
  import { marketCatalogue } from '../market-catalogue.svelte';
  import { compiledPlugins, nativePlugins, refreshPlugins } from '../lifecycle';
  import { installPlugin } from '../../../platform/plugin-host';
  import Section from '../../../panel/ui/Section.svelte';
  import MarketDetails from './MarketDetails.svelte';
  import PluginAuthor from './PluginAuthor.svelte';

  let { onopen }: { onopen: (id: string) => void } = $props();
  let selected = $state<string | null>(null);
  let drill = $state<'in' | 'out' | null>(null);
  let busy = $state(false);
  let root = $state<HTMLElement>();
  let savedScroll = 0;

  const details = $derived(
    marketCatalogue.hasData
      ? marketCatalogue.entries.find((entry) => entry.id === selected)
      : undefined,
  );
  const listMotion = $derived(drill === 'out' ? 'panel-drill-out' : '');
  const detailMotion = $derived(drill === 'in' ? 'panel-drill-in' : '');

  $effect(() => {
    void marketCatalogue.ensureLoaded();
  });

  function scrollHost() {
    return root?.parentElement ?? null;
  }

  function openDetails(id: string) {
    const host = scrollHost();
    savedScroll = host?.scrollTop ?? 0;
    drill = 'in';
    selected = id;
    if (host) {
      host.scrollTop = 0;
    }
  }

  function closeDetails() {
    drill = 'out';
    selected = null;
    void tick().then(() => {
      const host = scrollHost();
      if (host) {
        host.scrollTop = savedScroll;
      }
    });
  }

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
      if (id !== null) {
        await refreshPlugins();
      }
    } catch (error) {
      console.error(error);
      toast.error(failure);
    } finally {
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
  <div
    bind:this={root}
    class={detailMotion}
  >
    <MarketDetails
      entry={details}
      onback={closeDetails}
    >
      {@render action(details, '')}
    </MarketDetails>
  </div>
{:else}
  <div
    bind:this={root}
    class="mx-auto grid max-w-[960px] gap-10 px-6 py-9 {listMotion}"
  >
    <div class="flex items-center justify-between gap-4">
      <h1 class="font-display text-xl font-semibold tracking-wide">Market</h1>
      <div class="flex items-center gap-2">
        <Hint text="Refresh catalog">
          {#snippet children(props)}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh catalog"
              disabled={marketCatalogue.loading}
              onclick={() => {
                void marketCatalogue.ensureLoaded({ force: true });
              }}
            >
              <RefreshCw class={marketCatalogue.loading ? 'animate-spin' : ''} />
            </Button>
          {/snippet}
        </Hint>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onclick={installFile}><FileUp />Install from file</Button
        >
      </div>
    </div>
    <Section>
      {#if !marketCatalogue.hasData && marketCatalogue.failed}
        <div class="grid justify-items-center gap-3 py-10">
          <p class="text-sm font-semibold">Could not load catalog</p>
          <Button
            variant="outline"
            size="sm"
            onclick={() => {
              void marketCatalogue.ensureLoaded({ force: true });
            }}>Retry</Button
          >
        </div>
      {:else if !marketCatalogue.hasData}
        <!-- Shown only after 200 ms on an empty cold start, so fast responses never flash a loader. -->
        <div
          role="status"
          aria-label="Loading catalog"
          data-market-loading
          class="grid animate-in place-items-center py-16 text-muted-foreground fade-in fill-mode-backwards delay-200"
        >
          <LoaderCircle class="size-5 animate-spin" />
        </div>
      {:else}
        <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-3">
          {#each marketCatalogue.entries as entry (entry.id)}
            <article
              class="flex min-w-0 flex-col items-start gap-3 rounded-xl bg-white/[.03] p-4 transition-colors hover:bg-white/[.05]"
            >
              <button
                type="button"
                class="grid w-full justify-items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onclick={() => openDetails(entry.id)}
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

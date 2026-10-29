<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import Icon from '../../controls/ui/Icon.svelte';
  import { catalogEntries, type CatalogEntry } from '../plugin-store';
  import {
    bundledPlugins,
    plugins,
    pluginState,
    setCatalogUrl,
    setPluginEnabled,
  } from '../registry';
  import catalog from '../../../plugins/catalog.json';
  import Row from '../../../panel/ui/Row.svelte';
  import Section from '../../../panel/ui/Section.svelte';
  let remote = $state<CatalogEntry[]>([]);
  let url = $state('');
  let saving = $state(false);
  let installing = $state<string | null>(null);
  const entries = $derived([
    ...new Map(
      [...remote, ...catalogEntries(catalog)]
        .filter((p) => !bundledPlugins.some((b) => b.id === p.id && b.builtin))
        .map((p) => [p.id, p]),
    ).values(),
  ]);
  $effect(() => {
    url = $pluginState.catalogUrl;
  });
  $effect(() => {
    const index = $pluginState.catalogUrl;
    remote = [];
    if (!index) return;
    const abort = new AbortController();
    void fetch(index, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load plugin catalog');
        const parsed = catalogEntries(await response.json());
        if (!abort.signal.aborted) remote = parsed;
      })
      .catch((error) => {
        if (!abort.signal.aborted) {
          console.error(error);
          toast.error('Could not load catalog');
        }
      });
    return () => abort.abort();
  });
  async function save() {
    saving = true;
    try {
      await setCatalogUrl(url);
    } catch (error) {
      console.error(error);
      toast.error('Could not save catalog address');
    } finally {
      saving = false;
    }
  }
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
        {@const bundled = bundledPlugins.some((p) => p.id === entry.id)}
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
            <p class="text-xs text-muted-foreground">{entry.author}</p>
          </div>
          <Button
            class="mt-auto w-full"
            size="sm"
            variant={installed ? 'secondary' : 'default'}
            disabled={installed || !bundled || installing !== null}
            onclick={() => install(entry.id)}>{installed ? 'Installed' : 'Install'}</Button
          >
        </article>
      {/each}
    </div>
  </Section>
  <Section title="Catalog">
    <Row
      label="Index URL"
      wide
    >
      <form
        class="flex min-w-0 gap-2"
        onsubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          type="url"
          aria-label="Catalog index URL"
          class="min-w-0 flex-1"
          bind:value={url}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={saving}>Save</Button
        >
      </form>
    </Row>
  </Section>
</div>

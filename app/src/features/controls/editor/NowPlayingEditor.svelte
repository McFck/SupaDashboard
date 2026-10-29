<script lang="ts">
  import { Switch } from '$lib/components/ui/switch';
  import type { ControlConfig } from '../model';
  import { runtimeView } from '../../../app/runtime/state';
  import { commit } from '../../layout/history.svelte';
  import { KNOWN_APP_PREFIX, readNowPlayingOptions } from '../../media/now-playing';
  import { appOwners, mediaSources, statusSources } from '../../plugins/registry';
  import OptionTags from '../../plugins/ui/OptionTags.svelte';
  import PluginMark from '../../plugins/ui/PluginMark.svelte';

  type Row = { key: string; title: string; plugin?: string; unavailable: boolean; detail?: string };

  let { control }: { control: ControlConfig } = $props();
  const id = $props.id();
  const selected = $derived(readNowPlayingOptions(control.options) ?? []);
  const rows = $derived(sourceRows(selected, $runtimeView.status.catalogue));

  function decoded(key: string, prefix: string) {
    try {
      return decodeURIComponent(key.slice(prefix.length));
    } catch {
      return key;
    }
  }

  function savedTitle(key: string) {
    if (key.startsWith(KNOWN_APP_PREFIX)) {
      return decoded(key, KNOWN_APP_PREFIX);
    }
    return key.startsWith('app:') ? decoded(key, 'app:') : key;
  }

  /**
   * Registered sources, apps known to plugins, live apps nothing else claims, then saved choices that are
   * gone, so they stay visible and removable. The live list is the owner's mirror; nothing is enumerated here.
   */
  function sourceRows(saved: readonly string[], live: readonly { key: string; title: string }[]) {
    const rows = new Map<string, Row>();
    const add = (row: Row) => {
      if (!rows.has(row.key)) {
        rows.set(row.key, row);
      }
    };
    for (const source of statusSources.values()) {
      add({ key: source.id, title: source.title, plugin: source.plugin, unavailable: false });
    }
    // A media source without a status source can be commanded but never reports what plays.
    for (const source of mediaSources.values()) {
      add({ key: source.id, title: source.title, plugin: source.plugin, unavailable: true });
    }
    // An app a source already covers (Spotify) keeps one row: the source's.
    const claims = [...rows.keys()].filter((key) => key !== 'system');
    for (const [app, plugin] of appOwners) {
      if (!claims.includes(app)) {
        const title = app.charAt(0).toUpperCase() + app.slice(1);
        add({ key: KNOWN_APP_PREFIX + encodeURIComponent(app), title, plugin, unavailable: false });
        claims.push(app);
      }
    }
    for (const app of live) {
      const appId = savedTitle(app.key).toLowerCase();
      if (!claims.some((claim) => appId.includes(claim))) {
        add({ ...app, unavailable: false });
      }
    }
    for (const key of saved) {
      add({ key, title: savedTitle(key), unavailable: true });
    }
    const titles = [...rows.values()].map((row) => row.title);
    return [...rows.values()].map((row) =>
      titles.indexOf(row.title) === titles.lastIndexOf(row.title)
        ? row
        : { ...row, detail: savedTitle(row.key) },
    );
  }

  function save(sources: string[]) {
    commit('Now playing sources');
    control.options = { ...control.options, sources };
  }

  function toggle(key: string, on: boolean) {
    save(on ? [...selected, key] : selected.filter((entry) => entry !== key));
  }
</script>

<section
  class="grid gap-3"
  aria-labelledby="{id}-sources"
>
  <h3
    id="{id}-sources"
    class="section-label"
  >
    Sources
  </h3>
  <div class="grid">
    <div class="flex min-w-0 items-center gap-3 py-2">
      <label
        for="{id}-all"
        class="min-w-0 flex-1 truncate text-sm font-medium">All sources</label
      >
      <Switch
        id="{id}-all"
        checked={!selected.length}
        disabled={!selected.length}
        onCheckedChange={(on) => on && save([])}
      />
    </div>
    {#each rows as row, index (row.key)}
      <div class="flex min-w-0 items-center gap-3 py-2">
        <label
          for="{id}-{index}"
          class="flex min-w-0 flex-1 items-center gap-1.5 text-sm"
        >
          <span class="truncate">{row.title}</span>
          <PluginMark plugin={row.plugin} />
        </label>
        <OptionTags
          detail={row.detail}
          unavailable={row.unavailable}
        />
        <Switch
          id="{id}-{index}"
          checked={selected.includes(row.key)}
          disabled={row.unavailable && !selected.includes(row.key)}
          onCheckedChange={(on) => toggle(row.key, on)}
        />
      </div>
    {/each}
  </div>
</section>

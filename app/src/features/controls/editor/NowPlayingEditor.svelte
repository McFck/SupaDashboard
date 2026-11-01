<script lang="ts">
  import type { ControlConfig } from '../model';
  import { runtimeView } from '../../../app/runtime/state';
  import { commit } from '../../layout/history.svelte';
  import { KNOWN_APP_PREFIX, readNowPlayingOptions } from '../../media/now-playing';
  import { appOwners, mediaSources, statusSources } from '../../plugins/registry';
  import PluginMark from '../../plugins/ui/PluginMark.svelte';
  import SuggestionInput from '../../plugins/ui/SuggestionInput.svelte';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import { isRecord } from '../../automation/plain-data';
  import ScopeChoice from '../../../panel/ui/ScopeChoice.svelte';

  type Row = { key: string; title: string; plugin?: string; unavailable: boolean; detail?: string };

  let { control }: { control: ControlConfig } = $props();
  const id = $props.id();
  const selected = $derived(readNowPlayingOptions(control.options) ?? []);
  /** Chosen but switched off: kept as chips so they can be switched on again. Never read by the widget. */
  const idle = $derived(
    isRecord(control.options) && Array.isArray(control.options.idle)
      ? control.options.idle.filter((key): key is string => typeof key === 'string')
      : [],
  );
  const chosen = $derived([...selected, ...idle]);
  const rows = $derived(sourceRows(chosen, $runtimeView.status.catalogue));
  const chips = $derived(chosen.flatMap((key) => rows.find((row) => row.key === key) ?? []));
  const offered = $derived(
    rows
      .filter((row) => !row.unavailable && !chosen.includes(row.key))
      .map((row) => ({ value: row.key, label: row.title, plugin: row.plugin, detail: row.detail })),
  );

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

  function save(sources: string[], off: string[] = idle) {
    commit('Now playing sources');
    control.options = { ...control.options, sources, idle: off };
  }

  /** Stored `[]` means every source, so "Selected" starts from the first source that can be chosen. */
  function chooseMode(all: boolean) {
    const first = rows.find((row) => !row.unavailable);
    save(all || !first ? [] : [first.key], []);
  }

  function add(key: string) {
    if (key) {
      save([...selected, key]);
    }
  }

  /** Switching off the last enabled source would store `[]`, which means every source, so it stays on. */
  function toggle(key: string) {
    if (selected.includes(key)) {
      if (selected.length > 1) {
        save(
          selected.filter((entry) => entry !== key),
          [...idle, key],
        );
      }
    } else {
      save(
        [...selected, key],
        idle.filter((entry) => entry !== key),
      );
    }
  }

  function remove(key: string) {
    save(
      selected.filter((entry) => entry !== key),
      idle.filter((entry) => entry !== key),
    );
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
  <ScopeChoice
    all={!selected.length}
    count={selected.length}
    label="Sources"
    onchange={chooseMode}
  >
    <SuggestionInput
      strict
      value=""
      suggestions={offered}
      placeholder="Add source"
      aria-label="Add source"
      onchange={add}
    />
    <ul
      class="flex flex-wrap gap-2"
      aria-label="Chosen sources"
    >
      {#each chips as chip (chip.key)}
        {@const on = selected.includes(chip.key)}
        <li class="flex items-center rounded-md border {on ? 'bg-accent' : 'opacity-60'}">
          <button
            type="button"
            aria-pressed={on}
            class="flex min-w-0 items-center gap-1.5 rounded-l-md py-1 pr-1.5 pl-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => toggle(chip.key)}
          >
            <span class="truncate {on ? '' : 'line-through'}">{chip.title}</span>
            <PluginMark plugin={chip.plugin} />
          </button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove {chip.title}"
            onclick={() => remove(chip.key)}><X /></Button
          >
        </li>
      {/each}
    </ul>
  </ScopeChoice>
</section>

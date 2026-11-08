<script lang="ts">
  import { onMount } from 'svelte';
  import { isTauri } from '@tauri-apps/api/core';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import type { ControlConfig } from '../model';
  import { readMediaOptions, type MediaSource } from '../../media/content';
  import { commit } from '../../layout/history.svelte';
  import MediaSourceSummary from './MediaSourceSummary.svelte';
  import MediaSourceDialog from './MediaSourceDialog.svelte';
  import { mediaThumbnails } from './media-thumbnails.svelte';
  let { control }: { control: ControlConfig } = $props();
  let sources = $state<MediaSource[]>([]);
  let sourcesKey = '';
  let tauriAvailable = $state(false);
  let dialogOpen = $state(false);
  const options = $derived(readMediaOptions(control.options));
  const sourceThumbnail = mediaThumbnails(
    () => control,
    () => sources,
    () => tauriAvailable,
  );
  onMount(() => {
    tauriAvailable = isTauri();
  });
  $effect(() => {
    const next = options.sources;
    const key = JSON.stringify(next);
    if (key !== sourcesKey) {
      sourcesKey = key;
      sources = next.map((source, index) => ({
        ...source,
        id: source.id || `legacy-${index}-${source.kind}-${source.value}`,
      }));
    }
  });

  function save(label: string, patch: Record<string, unknown>) {
    commit(label);
    control.options = { ...(control.options ?? {}), ...patch };
  }
  function setSources(next: MediaSource[], label = 'Media sources') {
    const identified = next.map((source) => ({ ...source, id: source.id || crypto.randomUUID() }));
    sources = identified;
    save(label, { sources: identified });
  }

  function saveInterval(event: Event & { currentTarget: HTMLInputElement }) {
    const value = Number(event.currentTarget.value);
    if (Number.isFinite(value) && value >= 0 && value <= 86400) {
      save('Media interval', { interval: value });
    }
  }
</script>

<MediaSourceSummary
  {sources}
  {sourceThumbnail}
  onedit={() => (dialogOpen = true)}
/>

<section class="grid gap-3">
  <h3 class="section-label">Slideshow</h3>
  <div class="grid gap-1.5">
    <Label for="media-interval">Interval (seconds)</Label>
    <Input
      id="media-interval"
      type="number"
      min="0"
      max="86400"
      step="1"
      value={options.interval}
      onchange={saveInterval}
    />
  </div>
  <label class="flex items-center justify-between gap-3 text-sm"
    >Loop
    <Switch
      checked={options.loop}
      onCheckedChange={(checked) => save('Slideshow loop', { loop: checked })}
    />
  </label>
  <label class="flex items-center justify-between gap-3 text-sm"
    >Muted
    <Switch
      checked={options.muted}
      onCheckedChange={(checked) => save('Media mute', { muted: checked })}
    />
  </label>
</section>

<MediaSourceDialog
  bind:open={dialogOpen}
  control={() => control}
  {sources}
  {sourceThumbnail}
  {tauriAvailable}
  onchange={setSources}
/>

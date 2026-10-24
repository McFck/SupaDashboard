<script lang="ts">
  import { onMount } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import ImageIcon from '@lucide/svelte/icons/image';
  import Video from '@lucide/svelte/icons/video';
  import Link from '@lucide/svelte/icons/link';
  import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import { Separator } from '$lib/components/ui/separator';
  import type { ControlConfig } from '../core/controls';
  import { isVideoSource, mediaSourceType, mediaUrl, readMediaOptions, type MediaSource } from '../core/content';
  import { commit } from '../core/history.svelte';
  import { sortable } from '../lib/sortable';
  import Choice from '../editor/Choice.svelte';

  type SourceType = 'image-file' | 'video-file' | 'url';
  let { control }: { control: ControlConfig } = $props();
  let sources = $state<MediaSource[]>([]);
  let sourcesKey = '';
  let sourceList = $state<HTMLElement>();
  let tauriAvailable = $state(false);
  let picking = $state(false);
  let dialogOpen = $state(false);
  let draftType = $state<SourceType>('image-file');
  let draftId = $state('');
  let draftValue = $state('');
  let draftFit = $state<'cover' | 'contain'>('cover');
  let draftLoop = $state(true);
  let draftMuted = $state(true);
  let invalidDraft = $derived(draftType === 'url' && !!draftValue && !mediaUrl(draftValue));
  const options = $derived(readMediaOptions(control.options));
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'];
  const videoExtensions = ['mp4', 'm4v', 'webm', 'ogv'];

  onMount(() => { tauriAvailable = isTauri(); });

  $effect(() => {
    const next = readMediaOptions(control.options).sources;
    const key = JSON.stringify(next);
    if (key !== sourcesKey) {
      sourcesKey = key;
      sources = next.map((source, index) => ({ ...source, id: source.id || `legacy-${index}-${source.kind}-${source.value}` }));
    }
  });

  function save(label: string, patch: Record<string, unknown>) {
    commit(label);
    control.options = { ...(control.options ?? {}), ...patch };
  }
  function setSources(next: MediaSource[], label = 'Media sources') {
    const identified = next.map(source => ({ ...source, id: source.id || crypto.randomUUID() }));
    sources = identified;
    save(label, { sources: identified });
  }
  function reorder(from: number, to: number) {
    if (from === to) return;
    const next = [...sources], [source] = next.splice(from, 1);
    next.splice(to, 0, source);
    setSources(next, 'Reorder media sources');
  }
  function addSource() {
    draftType = 'image-file';
    draftId = crypto.randomUUID();
    draftValue = '';
    draftFit = 'cover';
    draftLoop = true;
    draftMuted = true;
    dialogOpen = true;
  }
  function editSource(source: MediaSource, index: number) {
    draftType = mediaSourceType(source);
    draftId = source.id || `legacy-${index}-${source.kind}-${source.value}`;
    draftValue = source.value;
    draftFit = source.fit ?? 'cover';
    draftLoop = source.loop ?? true;
    draftMuted = source.muted ?? true;
    dialogOpen = true;
  }
  function changeType(value: string) {
    const next = value as SourceType;
    if (draftType !== next && !(draftType === 'url' && next === 'url')) draftValue = '';
    draftType = next;
  }
  async function pickFile() {
    if (!tauriAvailable || picking) return;
    picking = true;
    try {
      const selected = await open({ multiple: false, directory: false, filters: [{
        name: draftType === 'video-file' ? 'Video' : 'Image',
        extensions: draftType === 'video-file' ? videoExtensions : imageExtensions,
      }] });
      if (typeof selected === 'string' && selected.trim()) draftValue = selected;
    } catch {
      // The dialog may be unavailable while the panel is closing.
    } finally {
      picking = false;
    }
  }
  function saveDraft() {
    if (!draftValue.trim() || invalidDraft) return;
    const value = draftType === 'url' ? mediaUrl(draftValue)! : draftValue;
    const nextSource: MediaSource = { id: draftId || crypto.randomUUID(), kind: draftType === 'url' ? 'url' : 'file', value,
      fit: draftFit, loop: draftLoop, muted: draftMuted };
    const existing = sources.findIndex(source => source.id === draftId);
    const next = [...sources];
    if (existing >= 0) next[existing] = nextSource;
    else next.push(nextSource);
    setSources(next, existing >= 0 ? 'Edit media source' : 'Add media source');
    dialogOpen = false;
  }
  function sourceUrl(source: MediaSource) {
    if (source.kind === 'url') return mediaUrl(source.value);
    if (!tauriAvailable || isVideoSource(source)) return undefined;
    try { return convertFileSrc(source.value); } catch { return undefined; }
  }
  function sourceName(source: MediaSource) {
    const path = source.kind === 'url' ? (() => { try { return new URL(source.value).pathname; } catch { return source.value; } })() : source.value;
    const name = path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || path;
    try { return decodeURIComponent(name); } catch { return name; }
  }
  function sourceLabel(source: MediaSource) {
    if (source.kind === 'url') return isVideoSource(source) ? 'Video URL' : 'URL';
    if (isVideoSource(source)) return 'Video';
    return /\.gif(?:$|[?#])/i.test(source.value) ? 'GIF' : 'Image';
  }
  function sourceIcon(source: MediaSource) {
    return source.kind === 'url' ? Link : isVideoSource(source) ? Video : ImageIcon;
  }
</script>

<section class="grid gap-3">
  <div class="flex items-center justify-between">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</h3>
    <Button variant="ghost" size="sm" aria-label="Add source" onclick={addSource}><Plus /> Add source</Button>
  </div>
  <div bind:this={sourceList} use:sortable={{ axis: 'y', items: () => Array.from(sourceList?.children ?? []) as HTMLElement[], onmove: reorder }}
    class="grid gap-1.5">
    {#each sources as source, index (source.id)}
      {@const thumb = sourceUrl(source)}
      {@const Icon = sourceIcon(source)}
      <div data-media-source class="flex min-w-0 items-center gap-2 rounded-md border border-border/60 p-1.5">
        <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label="Edit {sourceName(source)}"
          onclick={() => editSource(source, index)}>
          {#if thumb}
            <img src={thumb} alt="" draggable="false" class="size-9 shrink-0 rounded object-cover" />
          {:else}
            <span class="grid size-9 shrink-0 place-items-center rounded bg-muted"><Icon class="size-4" /></span>
          {/if}
          <span class="min-w-0 flex-1 truncate text-sm">{sourceName(source)}</span>
          <span class="shrink-0 text-xs text-muted-foreground">{sourceLabel(source)}</span>
        </button>
        <Button size="icon-sm" variant="ghost" aria-label="Delete {sourceName(source)}"
          onclick={() => setSources(sources.filter((_, at) => at !== index), 'Delete media source')}><Trash /></Button>
      </div>
    {/each}
  </div>
</section>

<Separator />

<section class="grid gap-3">
  <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Slideshow</h3>
  <div class="grid gap-1.5">
    <Label for="media-interval">Interval (seconds)</Label>
    <Input id="media-interval" type="number" min="0" max="86400" step="1" value={options.interval}
      onchange={event => {
        const value = Number(event.currentTarget.value);
        if (Number.isFinite(value) && value >= 0 && value <= 86400) save('Media interval', { interval: value });
      }} />
  </div>
  <label class="flex items-center justify-between gap-3 text-sm">Loop
    <Switch checked={options.loop} onCheckedChange={checked => save('Slideshow loop', { loop: checked })} />
  </label>
  <label class="flex items-center justify-between gap-3 text-sm">Muted
    <Switch checked={options.muted} onCheckedChange={checked => save('Media mute', { muted: checked })} />
  </label>
</section>

<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header><Dialog.Title>{sources.some(source => source.id === draftId) ? 'Edit source' : 'Add source'}</Dialog.Title></Dialog.Header>
    <div class="grid gap-3">
      <div class="grid gap-1.5">
        <Label for="media-source-type">Source type</Label>
        <Choice id="media-source-type" value={draftType} options={[
          { value: 'image-file', label: 'Image / GIF file' },
          { value: 'video-file', label: 'Video file' },
          { value: 'url', label: 'URL' },
        ]} aria-label="Source type" onchange={changeType} />
      </div>
      {#if draftType === 'url'}
        <div class="grid gap-1.5">
          <Label for="media-source-url">URL</Label>
          <Input id="media-source-url" type="url" value={draftValue} aria-invalid={invalidDraft}
            onchange={event => draftValue = event.currentTarget.value} />
        </div>
      {:else}
        <div class="flex gap-2">
          <Input value={draftValue ? sourceName({ kind: 'file', value: draftValue }) : ''} readonly aria-label="Selected file" />
          <Button variant="outline" disabled={!tauriAvailable || picking} onclick={pickFile}>Choose file</Button>
        </div>
      {/if}
      <div class="grid gap-1.5">
        <Label for="media-source-fit">Fit</Label>
        <Choice id="media-source-fit" value={draftFit} options={[{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }]}
          aria-label="Fit" onchange={value => draftFit = value as 'cover' | 'contain'} />
      </div>
      {#if draftType !== 'image-file'}
        <label class="flex items-center justify-between gap-3 text-sm">Video loop
          <Switch checked={draftLoop} onCheckedChange={checked => draftLoop = checked} />
        </label>
        <label class="flex items-center justify-between gap-3 text-sm">Video muted
          <Switch checked={draftMuted} onCheckedChange={checked => draftMuted = checked} />
        </label>
      {/if}
    </div>
    <Dialog.Footer class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={() => dialogOpen = false}>Cancel</Button>
      <Button size="sm" disabled={!draftValue.trim() || invalidDraft} onclick={saveDraft}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

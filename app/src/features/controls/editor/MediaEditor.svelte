<script lang="ts">
  import { onMount } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
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
  import type { ControlConfig } from '../model';
  import {
    isVideoSource,
    mediaSourceType,
    mediaUrl,
    readMediaOptions,
    type MediaSource,
  } from '../../media/content';
  import {
    cachedVideoThumbnail,
    captureVideoThumbnail,
    clearVideoThumbnail,
    videoThumbnailKey,
  } from '../../media/media-thumbnail';
  import { commit } from '../../layout/history.svelte';
  import { sortable } from '$lib/sortable';
  import Choice from '../../plugins/ui/Choice.svelte';

  type SourceType = 'image-file' | 'video-file' | 'url';
  let { control }: { control: ControlConfig } = $props();
  let sources = $state<MediaSource[]>([]);
  let sourcesKey = '';
  let sourceList = $state<HTMLElement>();
  let tauriAvailable = $state(false);
  let picking = $state(false);
  let dialogOpen = $state(false);
  let editorMode = $state<'list' | 'edit'>('list');
  let thumbnailRevision = $state(0);
  let mounted = true;
  let draftType = $state<SourceType>('image-file');
  let draftId = $state('');
  let draftValue = $state('');
  let draftFit = $state<'cover' | 'contain'>('cover');
  let draftLoop = $state(true);
  let draftMuted = $state(true);
  let invalidDraft = $derived(draftType === 'url' && !!draftValue && !mediaUrl(draftValue));
  const draftIsVideo = $derived(
    draftType === 'video-file' ||
      (draftType === 'url' && isVideoSource({ kind: 'url', value: draftValue })),
  );
  const options = $derived(readMediaOptions(control.options));
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'];
  const videoExtensions = ['mp4', 'm4v', 'webm', 'ogv'];

  onMount(() => {
    tauriAvailable = isTauri();
    return () => {
      mounted = false;
    };
  });

  $effect(() => {
    const next = readMediaOptions(control.options).sources;
    const key = JSON.stringify(next);
    if (key !== sourcesKey) {
      sourcesKey = key;
      sources = next.map((source, index) => ({
        ...source,
        id: source.id || `legacy-${index}-${source.kind}-${source.value}`,
      }));
    }
  });

  $effect(() => {
    const current = sources;
    const tauri = tauriAvailable;
    for (const source of current) {
      if (!isVideoSource(source) || source.thumbnail) continue;
      const key = videoThumbnailKey(source);
      if (cachedVideoThumbnail(key) || (!tauri && source.kind === 'file')) continue;
      const url = sourceUrl(source);
      if (!url) continue;
      void captureVideoThumbnail(key, url).then((thumbnail) => {
        if (!mounted || !thumbnail) return;
        thumbnailRevision++;
        if (thumbnail.persist) persistThumbnail(source, thumbnail.dataUrl);
      });
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
  function reorder(from: number, to: number) {
    if (from === to) return;
    const next = [...sources],
      [source] = next.splice(from, 1);
    next.splice(to, 0, source);
    setSources(next, 'Reorder media sources');
  }
  function openEditor() {
    editorMode = 'list';
    dialogOpen = true;
  }
  function addSource() {
    editorMode = 'edit';
    draftType = 'image-file';
    draftId = crypto.randomUUID();
    draftValue = '';
    draftFit = 'cover';
    draftLoop = true;
    draftMuted = true;
    dialogOpen = true;
  }
  function replaceSource(source: MediaSource, index: number) {
    editorMode = 'edit';
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
    const controlId = control.id;
    const sourceSnapshot = JSON.stringify(readMediaOptions(control.options).sources);
    picking = true;
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: draftType === 'video-file' ? 'Video' : 'Image',
            extensions: draftType === 'video-file' ? videoExtensions : imageExtensions,
          },
        ],
      });
      if (
        control.id !== controlId ||
        JSON.stringify(readMediaOptions(control.options).sources) !== sourceSnapshot
      )
        return;
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
    const nextSource: MediaSource = {
      id: draftId || crypto.randomUUID(),
      kind: draftType === 'url' ? 'url' : 'file',
      value,
      fit: draftFit,
      loop: draftLoop,
      muted: draftMuted,
    };
    const existing = sources.findIndex((source) => source.id === draftId);
    const next = [...sources];
    if (existing >= 0) {
      clearVideoThumbnail(videoThumbnailKey(next[existing]));
      next[existing] = nextSource;
    } else next.push(nextSource);
    setSources(next, existing >= 0 ? 'Edit media source' : 'Add media source');
    editorMode = 'list';
  }
  function sourceUrl(source: MediaSource) {
    if (source.kind === 'url') return mediaUrl(source.value);
    if (!tauriAvailable) return undefined;
    try {
      return convertFileSrc(source.value);
    } catch {
      return undefined;
    }
  }
  function sourceThumbnail(source: MediaSource) {
    void thumbnailRevision;
    return (
      source.thumbnail ??
      (isVideoSource(source) ? cachedVideoThumbnail(videoThumbnailKey(source)) : sourceUrl(source))
    );
  }
  function persistThumbnail(source: MediaSource, thumbnail: string) {
    const current = readMediaOptions(control.options).sources;
    let changed = false;
    const next = current.map((entry) => {
      const matches = source.id
        ? entry.id === source.id
        : entry.kind === source.kind && entry.value === source.value;
      if (!matches || entry.thumbnail) return entry;
      changed = true;
      return { ...entry, thumbnail };
    });
    if (changed) control.options = { ...(control.options ?? {}), sources: next };
  }
  function updateSource(source: MediaSource, patch: Partial<MediaSource>, label: string) {
    setSources(
      sources.map((entry) => (entry.id === source.id ? { ...entry, ...patch } : entry)),
      label,
    );
  }
  function sourceName(source: MediaSource) {
    const path =
      source.kind === 'url'
        ? (() => {
            try {
              return new URL(source.value).pathname;
            } catch {
              return source.value;
            }
          })()
        : source.value;
    const name = path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || path;
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  }
  function sourceLabel(source: MediaSource) {
    if (source.kind === 'url') return isVideoSource(source) ? 'Video URL' : 'URL';
    if (isVideoSource(source)) return 'Video';
    return /\.gif(?:$|[?#])/i.test(source.value) ? 'GIF' : 'Image';
  }
  function sourceIcon(source: MediaSource) {
    return isVideoSource(source) ? Video : source.kind === 'url' ? Link : ImageIcon;
  }
</script>

<section class="grid gap-3">
  <div class="flex min-w-0 items-center gap-3">
    <div class="min-w-0 flex-1">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</h3>
      <span class="text-sm tabular-nums"
        >{sources.length} {sources.length === 1 ? 'source' : 'sources'}</span
      >
    </div>
    <div
      aria-hidden="true"
      class="flex shrink-0 -space-x-1.5"
    >
      {#each sources.slice(0, 4) as source (source.id)}
        {@const thumb = sourceThumbnail(source)}
        {@const Icon = sourceIcon(source)}
        {#if thumb}
          <img
            src={thumb}
            alt=""
            draggable="false"
            class="size-7 rounded border-2 border-sidebar object-cover"
          />
        {:else}
          <span class="grid size-7 place-items-center rounded border-2 border-sidebar bg-muted"
            ><Icon class="size-3.5" /></span
          >
        {/if}
      {/each}
    </div>
    <Button
      variant="outline"
      size="sm"
      aria-label="Edit sources"
      onclick={openEditor}>Edit sources</Button
    >
  </div>
</section>

<Separator />

<section class="grid gap-3">
  <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Slideshow</h3>
  <div class="grid gap-1.5">
    <Label for="media-interval">Interval (seconds)</Label>
    <Input
      id="media-interval"
      type="number"
      min="0"
      max="86400"
      step="1"
      value={options.interval}
      onchange={(event) => {
        const value = Number(event.currentTarget.value);
        if (Number.isFinite(value) && value >= 0 && value <= 86400)
          save('Media interval', { interval: value });
      }}
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

<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content class="sm:max-w-2xl">
    <Dialog.Header
      ><Dialog.Title
        >{editorMode === 'list'
          ? 'Edit sources'
          : draftId
            ? 'Replace source'
            : 'Add source'}</Dialog.Title
      ></Dialog.Header
    >
    {#if editorMode === 'list'}
      <div
        bind:this={sourceList}
        use:sortable={{
          axis: 'y',
          handle: '[data-sort-handle]',
          items: () => Array.from(sourceList?.children ?? []) as HTMLElement[],
          onmove: reorder,
        }}
        class="grid max-h-[min(60dvh,520px)] gap-2 overflow-y-auto overscroll-contain pr-1"
      >
        {#each sources as source, index (source.id)}
          {@const thumb = sourceThumbnail(source)}
          {@const Icon = sourceIcon(source)}
          <div
            data-media-source
            class="grid min-w-0 gap-2 rounded-md border border-border/60 p-2"
          >
            <div class="flex min-w-0 items-center gap-2">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                data-sort-handle
                aria-label="Reorder {sourceName(source)}"><GripVertical /></Button
              >
              {#if thumb}
                <img
                  src={thumb}
                  alt=""
                  draggable="false"
                  class="size-10 shrink-0 rounded object-cover"
                />
              {:else}
                <span class="grid size-10 shrink-0 place-items-center rounded bg-muted"
                  ><Icon class="size-4" /></span
                >
              {/if}
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm">{sourceName(source)}</span>
                <span class="block text-xs text-muted-foreground">{sourceLabel(source)}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label="Replace {sourceName(source)}"
                onclick={() => replaceSource(source, index)}>Replace</Button
              >
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Delete {sourceName(source)}"
                onclick={() =>
                  setSources(
                    sources.filter((_, at) => at !== index),
                    'Delete media source',
                  )}><Trash /></Button
              >
            </div>
            <div class="grid grid-cols-2 items-center gap-3 pl-12">
              <Choice
                value={source.fit ?? 'cover'}
                options={[
                  { value: 'cover', label: 'Cover' },
                  { value: 'contain', label: 'Contain' },
                ]}
                aria-label="Fit {sourceName(source)}"
                onchange={(value) =>
                  updateSource(source, { fit: value as 'cover' | 'contain' }, 'Media fit')}
              />
              {#if isVideoSource(source)}
                <label class="flex items-center justify-between gap-2 text-xs"
                  >Loop
                  <Switch
                    checked={source.loop ?? true}
                    aria-label="Loop {sourceName(source)}"
                    onCheckedChange={(checked) =>
                      updateSource(source, { loop: checked }, 'Video loop')}
                  />
                </label>
                <label class="flex items-center justify-between gap-2 text-xs"
                  >Muted
                  <Switch
                    checked={source.muted ?? true}
                    aria-label="Muted {sourceName(source)}"
                    onCheckedChange={(checked) =>
                      updateSource(source, { muted: checked }, 'Video mute')}
                  />
                </label>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      <Dialog.Footer class="flex justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Add source"
          onclick={addSource}><Plus /> Add source</Button
        >
        <Button
          size="sm"
          onclick={() => (dialogOpen = false)}>Done</Button
        >
      </Dialog.Footer>
    {:else}
      <div class="grid gap-3">
        <div class="grid gap-1.5">
          <Label for="media-source-type">Source type</Label>
          <Choice
            id="media-source-type"
            value={draftType}
            options={[
              { value: 'image-file', label: 'Image / GIF file' },
              { value: 'video-file', label: 'Video file' },
              { value: 'url', label: 'URL' },
            ]}
            aria-label="Source type"
            onchange={changeType}
          />
        </div>
        {#if draftType === 'url'}
          <div class="grid gap-1.5">
            <Label for="media-source-url">URL</Label>
            <Input
              id="media-source-url"
              type="url"
              value={draftValue}
              aria-invalid={invalidDraft}
              onchange={(event) => (draftValue = event.currentTarget.value)}
            />
          </div>
        {:else}
          <div class="flex gap-2">
            <Input
              value={draftValue ? sourceName({ kind: 'file', value: draftValue }) : ''}
              readonly
              aria-label="Selected file"
            />
            <Button
              variant="outline"
              disabled={!tauriAvailable || picking}
              onclick={pickFile}>Choose file</Button
            >
          </div>
        {/if}
        <div class="grid gap-1.5">
          <Label>Fit</Label>
          <Choice
            value={draftFit}
            options={[
              { value: 'cover', label: 'Cover' },
              { value: 'contain', label: 'Contain' },
            ]}
            aria-label="Fit"
            onchange={(value) => (draftFit = value as 'cover' | 'contain')}
          />
        </div>
        {#if draftIsVideo}
          <label class="flex items-center justify-between gap-3 text-sm"
            >Video loop
            <Switch
              checked={draftLoop}
              onCheckedChange={(checked) => (draftLoop = checked)}
            />
          </label>
          <label class="flex items-center justify-between gap-3 text-sm"
            >Video muted
            <Switch
              checked={draftMuted}
              onCheckedChange={(checked) => (draftMuted = checked)}
            />
          </label>
        {/if}
      </div>
      <Dialog.Footer class="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onclick={() => (editorMode = 'list')}>Cancel</Button
        >
        <Button
          size="sm"
          disabled={!draftValue.trim() || invalidDraft}
          onclick={saveDraft}>Save</Button
        >
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>

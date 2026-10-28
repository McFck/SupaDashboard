<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import { sortable } from '$lib/sortable';
  import Choice from '../../plugins/ui/Choice.svelte';
  import type { ControlConfig } from '../model';
  import { isVideoSource, type MediaSource } from '../../media/content';
  import { clearVideoThumbnail, videoThumbnailKey } from '../../media/media-thumbnail';
  import { sourceIcon, sourceName, sourceLabel } from './media-source';
  import MediaSourceForm from './MediaSourceForm.svelte';
  let {
    open = $bindable(false),
    control,
    sources,
    sourceThumbnail,
    tauriAvailable,
    onchange,
  }: {
    open: boolean;
    control: () => ControlConfig;
    sources: MediaSource[];
    sourceThumbnail: (source: MediaSource) => string | undefined;
    tauriAvailable: boolean;
    onchange: (sources: MediaSource[], label: string) => void;
  } = $props();
  let sourceList = $state<HTMLElement>();
  let editing = $state(false);
  let draft = $state<MediaSource | null>(null);
  const title = $derived.by(() => {
    if (!editing) {
      return 'Edit sources';
    }
    return draft ? 'Replace source' : 'Add source';
  });
  $effect(() => {
    if (open) {
      editing = false;
      draft = null;
    }
  });
  function reorder(from: number, to: number) {
    if (from === to) {
      return;
    }
    const next = [...sources],
      [source] = next.splice(from, 1);
    next.splice(to, 0, source);
    onchange(next, 'Reorder media sources');
  }

  function updateSource(source: MediaSource, patch: Partial<MediaSource>, label: string) {
    onchange(
      sources.map((entry) => (entry.id === source.id ? { ...entry, ...patch } : entry)),
      label,
    );
  }

  function replaceSource(source: MediaSource) {
    draft = source;
    editing = true;
  }
  function addSource() {
    editing = true;
    draft = null;
  }
  function saveSource(source: MediaSource) {
    const existing = sources.findIndex((entry) => entry.id === draft?.id);
    const next = [...sources];
    if (existing >= 0) {
      clearVideoThumbnail(videoThumbnailKey(next[existing]));
      next[existing] = source;
    } else {
      next.push(source);
    }
    onchange(next, existing >= 0 ? 'Edit media source' : 'Add media source');
    editing = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-2xl">
    <Dialog.Header><Dialog.Title>{title}</Dialog.Title></Dialog.Header>
    {#if editing}
      <MediaSourceForm
        source={draft}
        {control}
        {tauriAvailable}
        onsave={saveSource}
        oncancel={() => (editing = false)}
      />
    {:else}
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
                onclick={() => replaceSource(source)}>Replace</Button
              >
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Delete {sourceName(source)}"
                onclick={() =>
                  onchange(
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
          onclick={() => (open = false)}>Done</Button
        >
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>

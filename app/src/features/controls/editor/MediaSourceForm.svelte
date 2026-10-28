<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import Choice from '../../plugins/ui/Choice.svelte';
  import type { ControlConfig } from '../model';
  import {
    isVideoSource,
    mediaSourceType,
    mediaUrl,
    readMediaOptions,
    type MediaSource,
  } from '../../media/content';
  import { sourceName } from './media-source';
  type SourceType = 'image-file' | 'video-file' | 'url';
  let {
    source,
    control,
    tauriAvailable,
    onsave,
    oncancel,
  }: {
    source: MediaSource | null;
    control: () => ControlConfig;
    tauriAvailable: boolean;
    onsave: (source: MediaSource) => void;
    oncancel: () => void;
  } = $props();
  let picking = $state(false);
  const draftId = $derived(source?.id ?? '');
  let draftType = $state<SourceType>('image-file');
  let draftValue = $state('');
  let draftFit = $state<'cover' | 'contain'>('cover');
  let draftLoop = $state(true);
  let draftMuted = $state(true);
  let invalidDraft = $derived(draftType === 'url' && !!draftValue && !mediaUrl(draftValue));
  const draftIsVideo = $derived(
    draftType === 'video-file' ||
      (draftType === 'url' && isVideoSource({ kind: 'url', value: draftValue })),
  );
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'];
  const videoExtensions = ['mp4', 'm4v', 'webm', 'ogv'];

  $effect(() => {
    draftType = source ? mediaSourceType(source) : 'image-file';
    draftValue = source?.value ?? '';
    draftFit = source?.fit ?? 'cover';
    draftLoop = source?.loop ?? true;
    draftMuted = source?.muted ?? true;
  });
  function changeType(value: string) {
    const next = value as SourceType;
    if (draftType !== next && !(draftType === 'url' && next === 'url')) {
      draftValue = '';
    }
    draftType = next;
  }
  async function pickFile() {
    if (!tauriAvailable || picking) {
      return;
    }
    const controlId = control().id;
    const sourceSnapshot = JSON.stringify(readMediaOptions(control().options).sources);
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
        control().id !== controlId ||
        JSON.stringify(readMediaOptions(control().options).sources) !== sourceSnapshot
      ) {
        return;
      }
      if (typeof selected === 'string' && selected.trim()) {
        draftValue = selected;
      }
    } catch {
      // The dialog may be unavailable while the panel is closing.
    } finally {
      picking = false;
    }
  }
  function saveDraft() {
    if (!draftValue.trim() || invalidDraft) {
      return;
    }
    const value = draftType === 'url' ? mediaUrl(draftValue)! : draftValue;
    const nextSource: MediaSource = {
      id: draftId || crypto.randomUUID(),
      kind: draftType === 'url' ? 'url' : 'file',
      value,
      fit: draftFit,
      loop: draftLoop,
      muted: draftMuted,
    };
    onsave(nextSource);
  }
</script>

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
        oninput={(event) => (draftValue = event.currentTarget.value)}
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
    onclick={oncancel}>Cancel</Button
  >
  <Button
    size="sm"
    disabled={!draftValue.trim() || invalidDraft}
    onclick={saveDraft}>Save</Button
  >
</Dialog.Footer>

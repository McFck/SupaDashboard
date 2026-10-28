<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { DEFAULT_MIXER_MAX_CHANNELS } from '../model';
  import IconPicker from './IconPicker.svelte';
  import { mixer } from '../../../plugins/core';
  import { controlById } from '../../settings/state.svelte';
  import { commit, labelEdit } from '../../layout/history.svelte';

  type Fixed = { target: string; label?: string; icon?: string };
  let { controlId }: { controlId: string } = $props();
  // Read through the settings store rather than mutating a prop.
  const control = $derived(controlById(controlId));
  const o = $derived(
    (control?.options ?? {}) as {
      channels?: 'auto' | Fixed[];
      max?: number;
      layout?: string;
    },
  );
  const fixed = $derived(Array.isArray(o.channels) ? o.channels : []);
  let running = $state<string[]>([]);
  mixer()
    .then((c) => (running = c.map((x) => x.target)))
    .catch(() => {});

  /** Typed fields pass 	yping so a word is one undo step, not one per keystroke. */
  function save(patch: Partial<typeof o>, label: string, typing = false) {
    if (!control) {
      return;
    }
    if (typing) {
      labelEdit(label);
    } else {
      commit(label);
    }
    control.options = { ...control.options, ...patch };
  }
  function setChannels(value: string) {
    if (!value) {
      return;
    }
    save(
      { channels: value === 'auto' ? 'auto' : running.slice(0, 4).map((target) => ({ target })) },
      'Mixer channels',
    );
  }
  function setMax(raw: string) {
    const max = Number(raw);
    if (Number.isInteger(max) && max >= 1 && max <= 12) {
      save({ max }, 'Mixer channel limit', true);
    }
  }
  function updateChannel(index: number, patch: Partial<Fixed>) {
    save(
      { channels: fixed.map((channel, i) => (i === index ? { ...channel, ...patch } : channel)) },
      'Edit mixer channel',
      true,
    );
  }
</script>

<div class="grid gap-3">
  <ToggleGroup.Root
    type="single"
    variant="outline"
    class="w-full"
    value={!o.channels || o.channels === 'auto' ? 'auto' : 'fixed'}
    onValueChange={setChannels}
  >
    <ToggleGroup.Item
      value="auto"
      class="flex-1">All playing apps</ToggleGroup.Item
    >
    <ToggleGroup.Item
      value="fixed"
      class="flex-1">Chosen apps</ToggleGroup.Item
    >
  </ToggleGroup.Root>
  <ToggleGroup.Root
    type="single"
    variant="outline"
    class="w-full"
    value={o.layout ?? 'auto'}
    onValueChange={(v) => {
      if (v) {
        save({ layout: v }, 'Mixer layout');
      }
    }}
  >
    <ToggleGroup.Item
      value="auto"
      class="flex-1">Auto</ToggleGroup.Item
    >
    <ToggleGroup.Item
      value="vertical"
      class="flex-1">Vertical</ToggleGroup.Item
    >
    <ToggleGroup.Item
      value="horizontal"
      class="flex-1">Horizontal</ToggleGroup.Item
    >
  </ToggleGroup.Root>
  <div class="grid grid-cols-[1fr_80px] items-center gap-2">
    <Label class="text-xs">Channels</Label>
    <Input
      type="number"
      min="1"
      max="12"
      value={o.max ?? DEFAULT_MIXER_MAX_CHANNELS}
      aria-label="Channel limit"
      oninput={(e) => setMax(e.currentTarget.value)}
    />
  </div>
  {#if Array.isArray(o.channels)}
    {#each fixed as ch, i (i)}
      <div class="grid min-w-0 gap-3 rounded-xl border bg-card p-3">
        <div class="flex min-w-0 items-end gap-2">
          <IconPicker
            value={ch.icon}
            onchange={(icon) => updateChannel(i, { icon })}
          />
          <div class="grid min-w-0 flex-1 gap-1">
            <Label class="text-[11px] text-muted-foreground">App</Label>
            <Input
              list="running-apps"
              value={ch.target}
              aria-label="Channel app"
              oninput={(event) => updateChannel(i, { target: event.currentTarget.value })}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove channel"
            onclick={() =>
              save({ channels: fixed.filter((_, index) => index !== i) }, 'Remove mixer channel')}
            ><Trash /></Button
          >
        </div>
        <div class="grid gap-1">
          <Label class="text-[11px] text-muted-foreground">Label</Label>
          <Input
            value={ch.label ?? ''}
            aria-label="Channel label"
            oninput={(event) => updateChannel(i, { label: event.currentTarget.value })}
          />
        </div>
      </div>
    {/each}
    <datalist id="running-apps"
      >{#each running as r}<option value={r}></option>{/each}</datalist
    >
    <Button
      variant="outline"
      size="sm"
      onclick={() => save({ channels: [...fixed, { target: 'system' }] }, 'Add mixer channel')}
      ><Plus /> Add channel</Button
    >
  {/if}
</div>

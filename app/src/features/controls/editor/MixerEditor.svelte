<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import type { ControlConfig } from '../model';
  import IconPicker from './IconPicker.svelte';
  import { mixer } from '../../../plugins/core';
  import { controlById } from '../../settings/state.svelte';

  type Fixed = { target: string; label?: string; icon?: string };
  let { controlId }: { controlId: string } = $props();
  // Read through the settings store rather than mutating a prop.
  const control = $derived(controlById(controlId) as ControlConfig);
  $effect.pre(() => { control.options ??= { channels: 'auto', max: 6 }; });
  const o = $derived((control.options ?? { channels: 'auto' }) as { channels: 'auto' | Fixed[]; max?: number; layout?: string });
  let running = $state<string[]>([]);
  mixer().then(c => (running = c.map(x => x.target))).catch(() => {});
</script>

<div class="grid gap-3">
  <ToggleGroup.Root type="single" variant="outline" class="w-full" value={o.channels === 'auto' ? 'auto' : 'fixed'}
    onValueChange={v => { if (v) control.options!.channels = v === 'auto' ? 'auto' : running.slice(0, 4).map(target => ({ target })); }}>
    <ToggleGroup.Item value="auto" class="flex-1">All playing apps</ToggleGroup.Item>
    <ToggleGroup.Item value="fixed" class="flex-1">Chosen apps</ToggleGroup.Item>
  </ToggleGroup.Root>
  <ToggleGroup.Root type="single" variant="outline" class="w-full" value={o.layout ?? 'auto'}
    onValueChange={v => { if (v) control.options!.layout = v; }}>
    <ToggleGroup.Item value="auto" class="flex-1">Auto</ToggleGroup.Item>
    <ToggleGroup.Item value="vertical" class="flex-1">Vertical</ToggleGroup.Item>
    <ToggleGroup.Item value="horizontal" class="flex-1">Horizontal</ToggleGroup.Item>
  </ToggleGroup.Root>
  <div class="grid grid-cols-[1fr_80px] items-center gap-2">
    <Label class="text-xs">Channels</Label>
    <Input type="number" min="1" max="12" value={o.max ?? 6} oninput={e => (control.options!.max = Number(e.currentTarget.value) || 6)} />
  </div>
  {#if o.channels !== 'auto'}
    {#each o.channels as ch, i (i)}
      <div class="grid min-w-0 gap-3 rounded-xl border bg-card p-3">
        <div class="flex min-w-0 items-end gap-2">
          <IconPicker value={ch.icon} onchange={n => (ch.icon = n)} />
          <div class="grid min-w-0 flex-1 gap-1"><Label class="text-[11px] text-muted-foreground">App</Label>
            <Input list="running-apps" bind:value={ch.target} /></div>
          <Button variant="ghost" size="icon" aria-label="Remove channel"
            onclick={() => (o.channels as Fixed[]).splice(i, 1)}><Trash /></Button>
        </div>
        <div class="grid gap-1"><Label class="text-[11px] text-muted-foreground">Label</Label>
          <Input bind:value={ch.label} /></div>
      </div>
    {/each}
    <datalist id="running-apps">{#each running as r}<option value={r}></option>{/each}</datalist>
    <Button variant="outline" size="sm" onclick={() => (o.channels as Fixed[]).push({ target: 'system' })}><Plus /> Add channel</Button>
  {/if}
</div>

<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import Icon from '../controls/Icon.svelte';
  import { pluginState, setPluginEnabled, type Plugin } from '../core/registry';
  import Row from './ui/Row.svelte';
  import Section from './ui/Section.svelte';
  let { plugin, onback }: { plugin: Plugin; onback: () => void } = $props();
  let removing = $state(false);
  function date(value?: string) {
    return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—';
  }
  function size(value?: number | string) {
    if (typeof value !== 'number') return value ?? '—';
    if (value < 1024) return `${value} B`;
    return value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  async function remove() {
    if (removing) return;
    removing = true;
    const id = plugin.id;
    try {
      if (!await confirm({ title: `Remove ${plugin.title}?`, action: 'Remove', destructive: true })) return;
      if (!$pluginState.installed[id] || $pluginState.uninstalled.includes(id)) return;
      await setPluginEnabled(id, false);
    } catch (error) { toast.error(String(error)); }
    finally { removing = false; }
  }
</script>

<div class="mx-auto grid max-w-[740px] gap-8 px-6 py-9">
  <Button variant="ghost" size="sm" class="w-fit" onclick={onback}><ArrowLeft />Plugins</Button>
  <div class="flex items-center gap-4">
    <span class="grid size-16 shrink-0 place-items-center rounded-2xl border bg-accent"><Icon name={plugin.icon ?? 'Puzzle'} size={30} /></span>
    <h1 class="text-2xl font-semibold tracking-tight">{plugin.title}</h1>
  </div>
  {#if plugin.description}<p class="text-[15px] leading-relaxed text-muted-foreground">{plugin.description}</p>{/if}
  <Section>
    <Row label="Author"><span class="text-sm">{plugin.author ?? '—'}</span></Row>
    <Row label="Version"><span class="text-sm tabular-nums">{plugin.version ?? '—'}</span></Row>
    <Row label="Last update"><span class="text-sm">{date(plugin.updated)}</span></Row>
    <Row label="Installed"><span class="text-sm">{date($pluginState.installed[plugin.id])}</span></Row>
    <Row label="Size"><span class="text-sm tabular-nums">{size(plugin.size)}</span></Row>
  </Section>
  {#if plugin.settings}
    {@const Settings = plugin.settings}
    <Section title="Settings"><Settings /></Section>
  {/if}
  {#if !plugin.default && !plugin.builtin}
    <Section><Row label="Remove plugin">
      <Button variant="destructive" size="sm" disabled={removing} onclick={() => { void remove(); }}>Remove</Button>
    </Row></Section>
  {/if}
</div>

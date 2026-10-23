<script lang="ts">
  // A plain "pick one of these" dropdown on top of the shadcn Select.
  import type { Component } from 'svelte';
  import * as Select from '$lib/components/ui/select';
  import PluginMark, { pluginTitle } from './PluginMark.svelte';

  type Option = { value: string; label: string; icon?: Component<any>; iconLabel?: string; disabled?: boolean; plugin?: string };
  let {
    value, options, onchange, placeholder = 'Choose…', class: className = 'w-full', id,
    'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby, onopen,
  }: {
    value: string; options: Option[]; onchange: (v: string) => void; placeholder?: string; class?: string;
    id?: string; 'aria-label'?: string; 'aria-labelledby'?: string; onopen?: () => void;
  } = $props();
  const selected = $derived(options.find(o => o.value === value));
  const accessibleLabel = $derived(ariaLabel && selected?.plugin && pluginTitle(selected.plugin)
    ? `${ariaLabel}, Plugin: ${pluginTitle(selected.plugin)}` : ariaLabel);
</script>

<Select.Root type="single" {value} onValueChange={v => onchange(v)} onOpenChange={open => { if (open) onopen?.(); }}>
  <Select.Trigger {id} aria-label={accessibleLabel} aria-labelledby={ariaLabelledby} class={className}>
    {#if selected?.icon}
      <selected.icon size={15} class="size-4 shrink-0" aria-hidden={selected.iconLabel ? 'true' : undefined} />
      {#if selected.iconLabel}<span class="sr-only">{selected.iconLabel}</span>{/if}
    {/if}
    <span class="min-w-0 flex-1 truncate text-left">{selected?.label ?? placeholder}</span>
    {#if selected?.plugin}<PluginMark plugin={selected.plugin} />{/if}
  </Select.Trigger>
  <Select.Content class="w-max min-w-64 max-w-[calc(100vw-2rem)]">
    <Select.Group>
      {#each options as o (o.value)}
        <Select.Item value={o.value} label={o.label} disabled={o.disabled}>
          {#if o.icon}<o.icon size={15} class="size-4 shrink-0" aria-hidden={o.iconLabel ? 'true' : undefined} />{/if}
          {#if o.iconLabel}<span class="sr-only">{o.iconLabel}</span>{/if}
          <span class="min-w-0 flex-1 truncate">{o.label}</span>
          {#if o.plugin}<PluginMark plugin={o.plugin} />{/if}
        </Select.Item>
      {/each}
    </Select.Group>
  </Select.Content>
</Select.Root>

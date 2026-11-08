<script lang="ts">
  // A plain "pick one of these" dropdown on top of the shadcn Select.
  import type { Component } from 'svelte';
  import * as Select from '$lib/components/ui/select';
  import OptionTags from './OptionTags.svelte';
  import PluginMark, { pluginTitle } from './PluginMark.svelte';
  import type { TileAppearance } from '../../controls/model';
  import StateSwatch from '../../controls/editor/StateSwatch.svelte';

  type Option = {
    value: string;
    label: string;
    icon?: Component<any>;
    iconLabel?: string;
    disabled?: boolean;
    plugin?: string;
    detail?: string;
    unavailable?: boolean;
    appearance?: TileAppearance;
  };
  let {
    value,
    options,
    onchange,
    placeholder = 'Choose…',
    class: className = 'w-full',
    id,
    'aria-label': ariaLabel,
    onopen,
    showPluginMark = true,
  }: {
    value: string;
    options: Option[];
    onchange: (v: string) => void;
    placeholder?: string;
    class?: string;
    id?: string;
    'aria-label'?: string;
    onopen?: () => void;
    showPluginMark?: boolean;
  } = $props();
  const selected = $derived(options.find((o) => o.value === value));
  // Leading icons get one fixed slot on every row and the trigger, so all labels share one left edge.
  const iconSlot = $derived(options.some((o) => o.icon));
  const accessibleLabel = $derived(
    ariaLabel && selected?.plugin && pluginTitle(selected.plugin)
      ? `${ariaLabel}, Plugin: ${pluginTitle(selected.plugin)}`
      : ariaLabel,
  );
</script>

{#snippet leading(o: Option | undefined)}
  {#if o?.appearance}<StateSwatch appearance={o.appearance} />{/if}
  {#if iconSlot}<span class="flex size-4 shrink-0 items-center justify-center"
      >{#if o?.icon}<o.icon
          size={15}
          class="size-4"
          aria-hidden={o.iconLabel ? 'true' : undefined}
        />{/if}</span
    >{/if}
  {#if o?.iconLabel}<span class="sr-only">{o.iconLabel}</span>{/if}
{/snippet}

<Select.Root
  type="single"
  {value}
  onValueChange={(v) => onchange(v)}
  onOpenChange={(open) => {
    if (open) onopen?.();
  }}
>
  <Select.Trigger
    {id}
    aria-label={accessibleLabel}
    class={className}
  >
    {@render leading(selected)}
    <span class="min-w-0 flex-1 truncate text-left">{selected?.label ?? placeholder}</span>
    <span class="ml-2 inline-flex shrink-0 items-center gap-2">
      <OptionTags
        detail={selected?.detail}
        unavailable={selected?.unavailable}
      />
      {#if showPluginMark && selected?.plugin}<PluginMark plugin={selected.plugin} />{/if}
    </span>
  </Select.Trigger>
  <Select.Content class="w-max min-w-64 max-w-[calc(100vw-2rem)]">
    <Select.Group>
      {#each options as o (o.value)}
        <Select.Item
          value={o.value}
          label={o.label}
          disabled={o.disabled}
        >
          {@render leading(o)}
          <span class="min-w-0 flex-1 truncate">{o.label}</span>
          <span class="ml-2 inline-flex shrink-0 items-center gap-2">
            <OptionTags
              detail={o.detail}
              unavailable={o.unavailable}
            />
            {#if showPluginMark && o.plugin}<PluginMark plugin={o.plugin} />{/if}
          </span>
        </Select.Item>
      {/each}
    </Select.Group>
  </Select.Content>
</Select.Root>

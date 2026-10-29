<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import OptionTags from './OptionTags.svelte';
  import PluginMark from './PluginMark.svelte';

  type Item = {
    key: string;
    title: string;
    plugin?: string;
    unavailable: boolean;
    detail?: string;
  };

  let {
    items,
    selected,
    label,
    ontoggle,
  }: {
    items: readonly Item[];
    selected: readonly string[];
    label: string;
    ontoggle: (key: string, on: boolean) => void;
  } = $props();
</script>

<div
  role="group"
  aria-label={label}
  class="grid"
>
  {#each items as item (item.key)}
    {@const on = selected.includes(item.key)}
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={item.unavailable && !on}
      class="flex min-w-0 items-center gap-3 rounded-md py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      onclick={() => ontoggle(item.key, !on)}
    >
      <span
        class="flex size-4 shrink-0 items-center justify-center rounded-sm border border-input {on
          ? 'border-primary bg-primary text-primary-foreground'
          : ''}"
      >
        {#if on}<Check
            size={12}
            strokeWidth={3}
            aria-hidden="true"
          />{/if}
      </span>
      <span class="flex min-w-0 flex-1 items-center gap-1.5">
        <span class="truncate">{item.title}</span>
        <PluginMark plugin={item.plugin} />
      </span>
      <OptionTags
        detail={item.detail}
        unavailable={item.unavailable}
      />
    </button>
  {/each}
</div>

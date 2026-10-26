<script lang="ts">
  import { untrack } from 'svelte';
  import { Combobox } from 'bits-ui';
  import { Input } from '$lib/components/ui/input';
  import PluginMark from './PluginMark.svelte';
  import type { Option } from '../features/plugins/contracts';

  let { value, suggestions, provider, onchange, onrefresh }: {
    value: string; suggestions: Option[]; provider?: string; onchange: (value: string) => void; onrefresh?: () => void;
  } = $props();
  let query = $state(untrack(() => value));
  const filtered = $derived.by(() => {
    const search = query.trim().toLocaleLowerCase();
    return search ? suggestions.filter(option => `${option.label} ${option.value}`.toLocaleLowerCase().includes(search)) : suggestions;
  });

  $effect(() => {
    if (query !== value) query = value;
  });
  function input(event: Event) {
    query = (event.currentTarget as HTMLInputElement).value;
    onchange(query);
  }
  function choose(next: string) {
    query = next;
    onchange(next);
  }
</script>

<Combobox.Root type="single" value={value} inputValue={query} items={suggestions.map(option => ({ value: option.value, label: option.label }))}
  onValueChange={choose} onOpenChange={open => { if (open) onrefresh?.(); }}>
  <Combobox.Input class="w-full min-w-0" oninput={input}>
    {#snippet child({ props })}<Input {...props} />{/snippet}
  </Combobox.Input>
  <Combobox.Portal>
    <Combobox.Content class="z-50 max-h-60 min-w-(--bits-select-anchor-width) overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
      <Combobox.Group>
        {#each filtered as option (option.value)}
          <Combobox.Item value={option.value} label={option.label}
            class="flex min-w-0 cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground">
            <span class="min-w-0 flex-1 truncate">{option.label}</span>
            <PluginMark plugin={option.plugin ?? provider} />
          </Combobox.Item>
        {/each}
      </Combobox.Group>
    </Combobox.Content>
  </Combobox.Portal>
</Combobox.Root>

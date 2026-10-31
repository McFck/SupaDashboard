<script lang="ts">
  import { untrack } from 'svelte';
  import { Combobox } from 'bits-ui';
  import { Input } from '$lib/components/ui/input';
  import OptionTags from './OptionTags.svelte';
  import PluginMark from './PluginMark.svelte';
  import Icon from '../../controls/ui/Icon.svelte';
  import type { Option } from '../contracts';

  let {
    value,
    suggestions,
    provider,
    onchange,
    onrefresh,
  }: {
    value: string;
    suggestions: Option[];
    provider?: string;
    onchange: (value: string) => void;
    onrefresh?: () => void;
  } = $props();
  let query = $state(untrack(() => value));
  let open = $state(false);
  let field = $state<HTMLElement | null>(null);
  // The field may show an option's label instead of its value, so either one finds the selected option.
  const selected = $derived(
    suggestions.find((option) => option.value === value || option.label === value),
  );
  const filtered = $derived.by(() => {
    const search = query.trim().toLocaleLowerCase();
    return search
      ? suggestions.filter((option) =>
          `${option.label} ${option.value}`.toLocaleLowerCase().includes(search),
        )
      : suggestions;
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
    // A picked suggestion is committed: close, and leave the field so it does not reopen.
    open = false;
    field?.blur();
  }
</script>

<Combobox.Root
  type="single"
  bind:open
  {value}
  inputValue={query}
  items={suggestions.map((option) => ({ value: option.value, label: option.label }))}
  onValueChange={choose}
  onOpenChange={(open) => {
    if (open) onrefresh?.();
  }}
>
  <div class="relative min-w-0 flex-1">
    {#if selected?.iconName}
      <span
        class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
      >
        <Icon
          name={selected.iconName}
          size={16}
        />
      </span>
    {/if}
    <Combobox.Input
      bind:ref={field}
      class="w-full min-w-0"
      oninput={input}
    >
      {#snippet child({ props })}<Input
          {...props}
          class={selected?.iconName ? 'pl-9' : ''}
        />{/snippet}
    </Combobox.Input>
  </div>
  {#if open}
    <Combobox.Portal>
      <Combobox.Content
        class="z-50 max-h-60 min-w-(--bits-select-anchor-width) overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
      >
        <Combobox.Group>
          {#each filtered as option (option.value)}
            <Combobox.Item
              value={option.value}
              label={option.label}
              class="flex min-w-0 cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
            >
              {#if option.iconName}
                <span
                  class="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
                >
                  <Icon
                    name={option.iconName}
                    size={16}
                  />
                </span>
              {/if}
              <span class="min-w-0 flex-1 truncate">{option.label}</span>
              <OptionTags
                detail={option.detail}
                unavailable={option.unavailable}
              />
              <PluginMark plugin={option.plugin ?? provider} />
            </Combobox.Item>
          {/each}
        </Combobox.Group>
      </Combobox.Content>
    </Combobox.Portal>
  {/if}
</Combobox.Root>

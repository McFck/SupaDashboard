<script lang="ts">
  import { untrack } from 'svelte';
  import { Combobox } from 'bits-ui';
  import { Input } from '$lib/components/ui/input';
  import Skeleton from '$lib/components/ui/skeleton/Skeleton.svelte';
  import { rankOptions } from '../ranking';
  import OptionTags from './OptionTags.svelte';
  import PluginMark from './PluginMark.svelte';
  import Icon from '../../controls/ui/Icon.svelte';
  import type { Option } from '../contracts';

  let {
    value,
    suggestions,
    provider,
    strict = false,
    id,
    placeholder,
    'aria-label': ariaLabel,
    onchange,
    onrefresh,
  }: {
    value: string;
    suggestions: Option[];
    provider?: string;
    /** Typing only searches; the answer is always one of the suggestions' values. */
    strict?: boolean;
    id?: string;
    placeholder?: string;
    'aria-label'?: string;
    onchange: (value: string) => void;
    onrefresh?: () => void;
  } = $props();
  let typing = $state(false);
  let open = $state(false);
  let field = $state<HTMLElement | null>(null);
  let anchor = $state<HTMLElement | null>(null);
  // The field may show an option's label instead of its value, so either one finds the selected option.
  const selected = $derived(
    suggestions.find((option) => option.value === value || option.label === value),
  );
  const display = $derived(selected?.label ?? value);
  let query = $state(untrack(() => display));
  // Until the user types, the list is whole so the current pick can be swapped for another.
  const filtered = $derived(rankOptions(suggestions, typing ? query : ''));

  $effect(() => {
    query = display;
  });
  // Opening here bypasses the combobox's own onOpenChange, so the options refresh is asked for directly.
  function show() {
    if (!open) {
      open = true;
      onrefresh?.();
    }
  }
  function input(event: Event) {
    query = (event.currentTarget as HTMLInputElement).value;
    typing = true;
    show();
    if (!strict) {
      onchange(query);
    }
  }
  function choose(next: string) {
    typing = false;
    // A strict field shows the parent's answer again once it has taken the pick.
    query = strict ? display : (suggestions.find((option) => option.value === next)?.label ?? next);
    onchange(next);
    // A picked suggestion is committed: close, and leave the field so it does not reopen.
    open = false;
    field?.blur();
    // The combobox writes the picked label into the input itself; a field that keeps its answer elsewhere takes it back.
    if (strict) {
      setTimeout(() => {
        if (field instanceof HTMLInputElement && !typing) {
          field.value = query;
        }
      });
    }
  }
  /** A value typed out in full counts as picked; anything else in a strict field is dropped. */
  function leave() {
    const text = query.trim().toLocaleLowerCase();
    const exact = text
      ? suggestions.find(
          (option) =>
            option.label.toLocaleLowerCase() === text || option.value.toLocaleLowerCase() === text,
        )
      : undefined;
    typing = false;
    if (exact && exact.value !== value) {
      choose(exact.value);
    } else if (strict) {
      query = display;
    }
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
  <div
    bind:this={anchor}
    class="relative min-w-0 flex-1"
  >
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
      onblur={leave}
      onclick={show}
    >
      {#snippet child({ props })}<Input
          {...props}
          {id}
          {placeholder}
          aria-label={ariaLabel}
          aria-busy={selected?.loading || undefined}
          class={selected?.iconName ? 'pl-9' : ''}
        />{/snippet}
    </Combobox.Input>
    {#if selected?.loading}
      <Skeleton class="pointer-events-none absolute top-1/2 left-9 h-3.5 w-24 -translate-y-1/2" />
    {/if}
  </div>
  {#if open}
    <Combobox.Portal>
      <Combobox.Content
        customAnchor={anchor}
        class="z-50 max-h-60 w-(--bits-combobox-anchor-width) overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
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
          {#if !filtered.length}<div class="px-3 py-2 text-sm text-muted-foreground">
              No match
            </div>{/if}
        </Combobox.Group>
      </Combobox.Content>
    </Combobox.Portal>
  {/if}
</Combobox.Root>

<script lang="ts">
  import { untrack } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Disclosure from '$lib/components/ui/disclosure';
  import { Input } from '$lib/components/ui/input';
  import Icon from '../../controls/ui/Icon.svelte';
  import { actions, actionsByPlugin } from '../../plugins/registry';
  import PluginMark from '../../plugins/ui/PluginMark.svelte';
  import { animateGroupLayout } from '$lib/components/ui/disclosure/motion';

  let {
    value,
    onpick,
    inline = false,
  }: { value: string; onpick: (id: string) => void; inline?: boolean } = $props();
  const allGroups = $derived(actionsByPlugin());
  const selectedAction = $derived(actions.get(value));
  let open = $state(false);
  let query = $state('');
  let manualOpen: string[] = $state(
    untrack(() => {
      const plugin =
        inline &&
        allGroups.find((group) => group.actions.some((action) => action.id === value))?.plugin.id;
      return plugin ? [plugin] : [];
    }),
  );
  let results = $state<HTMLElement>();
  const groups = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return allGroups
      .map((group) => ({
        ...group,
        matches: group.actions.filter((action) =>
          `${group.plugin.title} ${action.title} ${action.id}`.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.matches.length);
  });
  const matchCount = $derived(groups.reduce((sum, group) => sum + group.matches.length, 0));

  function dialogChanged(next: boolean) {
    if (!next) return;
    query = '';
    const selectedPlugin = allGroups.find((group) =>
      group.actions.some((action) => action.id === value),
    )?.plugin.id;
    manualOpen = selectedPlugin ? [selectedPlugin] : [];
  }

  function search(event: Event) {
    const next = (event.currentTarget as HTMLInputElement).value;
    if (next === query) return;
    animateGroupLayout(results);
    query = next;
  }

  function setManualOpen(id: string, next: boolean) {
    manualOpen = next
      ? [...manualOpen.filter((value) => value !== id), id]
      : manualOpen.filter((value) => value !== id);
  }

  function pick(id: string) {
    onpick(id);
    open = false;
  }
</script>

{#snippet pickerBody()}
  <div class="flex min-h-0 min-w-0 flex-col {inline ? 'gap-3' : 'gap-4'}">
    <div class="relative min-w-0">
      <Input
        value={query}
        oninput={search}
        placeholder="Search actions"
        aria-label="Search actions"
        class={query.trim() ? 'pr-24' : ''}
      />
      {#if query.trim()}
        <span
          aria-live="polite"
          class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
        >
          {matchCount}
          {matchCount === 1 ? 'match' : 'matches'}
        </span>
      {/if}
    </div>
    <div
      bind:this={results}
      class="picker-results flex min-h-0 min-w-0 shrink-0 flex-col
      {inline ? '' : 'shrink overflow-y-auto [scrollbar-gutter:stable]'}"
      style={inline ? undefined : 'height: min(55dvh, 420px)'}
    >
      {#if groups.length === 0}<div class="py-3 text-center text-sm text-muted-foreground">
          No actions
        </div>{/if}
      {#each groups as group (group.plugin.id)}
        {@const groupOpen = !!query.trim() || manualOpen.includes(group.plugin.id)}
        <Disclosure.Root
          list={results}
          open={groupOpen}
          onOpenChange={(next) => setManualOpen(group.plugin.id, next)}
          disabled={!!query.trim()}
          triggerClass={inline ? 'min-h-10 p-2' : ''}
          class="last:border-b-0"
        >
          {#snippet trigger()}
            <Icon
              name={group.plugin.icon ?? 'Puzzle'}
              size={20}
            />
            <span class="min-w-0 flex-1 break-words text-sm font-medium [overflow-wrap:anywhere]"
              >{group.plugin.title}</span
            >

            <span class="font-sans text-xs [font-variant-numeric:normal] text-muted-foreground"
              >{group.actions.length}</span
            >
            <span
              class="inline-flex shrink-0 transition-transform motion-reduce:transition-none"
              style:transform={groupOpen ? 'rotate(180deg)' : 'rotate(0deg)'}
            >
              <ChevronDown size={16} />
            </span>
          {/snippet}
          {#snippet children()}
            <div class="grid gap-1 pb-3 pl-8 pt-2">
              {#each group.matches as action (action.id)}
                <Button
                  variant="ghost"
                  aria-pressed={action.id === value}
                  class="h-auto min-h-8 w-full min-w-0 justify-start whitespace-normal break-words px-2 text-left font-normal [overflow-wrap:anywhere] {action.id ===
                  value
                    ? 'bg-accent ring-1 ring-border'
                    : ''}"
                  onclick={() => pick(action.id)}>{action.title}</Button
                >
              {/each}
            </div>
          {/snippet}
        </Disclosure.Root>
      {/each}
    </div>
  </div>
{/snippet}

{#if inline}
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">{@render pickerBody()}</div>
{:else}
  <Dialog.Root
    bind:open
    onOpenChange={dialogChanged}
  >
    <Dialog.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="outline"
          class="w-full min-w-0 justify-between font-normal"
        >
          <span class="min-w-0 truncate"
            >{(selectedAction?.title ?? value) || 'Choose an action'}</span
          >
          <PluginMark plugin={selectedAction?.plugin} />
          <ChevronDown class="shrink-0 opacity-50" />
        </Button>
      {/snippet}
    </Dialog.Trigger>
    <Dialog.Content
      class="flex min-h-0 max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-y-auto p-4 sm:max-w-lg"
    >
      <Dialog.Header><Dialog.Title>Choose an action</Dialog.Title></Dialog.Header>
      {@render pickerBody()}
    </Dialog.Content>
  </Dialog.Root>
{/if}

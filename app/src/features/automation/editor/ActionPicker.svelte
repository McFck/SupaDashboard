<script lang="ts">
  import { untrack } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Button } from '$lib/components/ui/button';
  import * as Disclosure from '$lib/components/ui/disclosure';
  import { Input } from '$lib/components/ui/input';
  import Icon from '../../controls/ui/Icon.svelte';
  import { actionsByPlugin } from '../../plugins/registry';
  import { animateGroupLayout } from '$lib/components/ui/disclosure/group-layout';

  let { value, onpick }: { value: string; onpick: (id: string) => void } = $props();
  const allGroups = $derived(actionsByPlugin());
  let query = $state('');
  let manualOpen: string[] = $state(
    untrack(() => {
      const plugin = allGroups.find((group) => group.actions.some((action) => action.id === value))
        ?.plugin.id;
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
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <div class="flex min-h-0 min-w-0 flex-col gap-3">
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
      class="picker-results flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
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
          triggerClass="min-h-10 p-2"
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
                  onclick={() => onpick(action.id)}>{action.title}</Button
                >
              {/each}
            </div>
          {/snippet}
        </Disclosure.Root>
      {/each}
    </div>
  </div>
</div>

<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { DropdownMenu } from 'bits-ui';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { listStepCount, TRIGGER_LABELS, TRIGGERS, type Trigger } from '../scenario';
  import PluginMark, { pluginTitle } from '../../plugins/ui/PluginMark.svelte';
  import type { ScenarioDraftEditor } from './scenario-draft.svelte';

  let {
    editor,
    blockedTriggers,
  }: { editor: ScenarioDraftEditor; blockedTriggers: ReadonlySet<Trigger> } = $props();

  const draft = $derived(editor.draft!);
</script>

<nav
  aria-label="Scenario triggers"
  class="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto bg-sidebar p-3 [scrollbar-gutter:stable]"
>
  {#each TRIGGERS as trigger (trigger)}
    {@const label = TRIGGER_LABELS[trigger]}
    {@const steps = listStepCount(draft.scenario.triggers[trigger])}
    {@const selected = editor.selectedKey === `trigger:${trigger}`}
    <Button
      variant={selected ? 'secondary' : 'ghost'}
      size="sm"
      class="w-full min-w-0 justify-between gap-2 px-2.5"
      disabled={blockedTriggers.has(trigger)}
      aria-label={`${label}, ${steps} steps`}
      aria-pressed={selected}
      onclick={() => editor.selectList(`trigger:${trigger}`)}
    >
      <span class="truncate">{label}</span>
      <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{steps}</span>
    </Button>
  {/each}
  <div class="mt-4 grid gap-2">
    <div class="flex items-center justify-between gap-2 border-x border-transparent px-2.5">
      <h3 class="text-xs font-semibold text-muted-foreground">Events</h3>
      <Badge
        variant="secondary"
        class="-mr-1.5 border-0 px-1.5 py-0 text-xs text-muted-foreground"
        ><span class="tabular-nums">{draft.scenario.events.length}</span></Badge
      >
    </div>
    {#each draft.scenario.events as event (event.id)}
      {@const definition = editor.eventDefinition(event.eventId)}
      {@const providerTitle = pluginTitle(definition?.plugin)}
      {@const steps = listStepCount(event.list)}
      {@const selected = editor.selectedKey === `event:${event.id}`}
      <div class="flex min-w-0 items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Remove event listener"
          onclick={() => editor.removeEvent(event.id)}
        >
          <Trash />
        </Button>
        <Button
          variant={selected ? 'secondary' : 'ghost'}
          size="sm"
          class="w-full min-w-0 flex-1 justify-start gap-2 truncate px-2.5"
          aria-label={`${editor.eventLabel(event)}, ${steps} steps${providerTitle ? `, Plugin: ${providerTitle}` : ''}`}
          aria-pressed={selected}
          onclick={() => editor.selectList(`event:${event.id}`)}
        >
          <span class="truncate">{editor.eventLabel(event)}</span>
          <PluginMark plugin={definition?.plugin} />
          <span class="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{steps}</span>
        </Button>
      </div>
    {/each}
    {#if editor.eventDefinitions.length}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="outline"
              size="sm"
              class="w-full justify-start"
            >
              <Plus /> Add event
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={6}
            align="start"
            class="z-50 grid min-w-48 gap-0.5 rounded-xl bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-border"
          >
            {#each editor.eventDefinitions as definition (definition.id)}
              <DropdownMenu.Item
                onSelect={() => editor.addEvent(definition.id)}
                class="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 outline-none data-highlighted:bg-accent"
              >
                <span class="min-w-0 flex-1 truncate">{definition.title}</span>
                <PluginMark plugin={definition.plugin} />
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    {/if}
  </div>
</nav>

<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Switch } from '$lib/components/ui/switch';
  import { pendingAppVariable } from '../../apps/keys';
  import { clonePlain } from '../../automation/plain-data';
  import type { Predicate } from '../../automation/scenario';
  import { conditionIssue } from '../../automation/validate';
  import ConditionEditor from '../../automation/editor/ConditionEditor.svelte';
  import type { Page } from '../../settings/schema';
  import { setPageAutoSwitch } from '../page-commands';
  import Row from '../../../panel/ui/Row.svelte';

  let {
    open = $bindable(false),
    page,
  }: {
    open?: boolean;
    page: Page;
  } = $props();

  let rules = $state<Predicate[]>([]);
  let returnOnLeave = $state(true);
  let loadedPageId = '';

  const baseline = $derived(
    JSON.stringify({
      rules: page.autoSwitch?.rules ?? [],
      returnOnLeave: page.autoSwitch?.returnOnLeave ?? true,
    }),
  );
  const current = $derived(JSON.stringify({ rules, returnOnLeave }));
  const dirty = $derived(current !== baseline);
  const firstIssue = $derived.by(() => {
    for (const rule of rules) {
      const issue = conditionIssue(rule);
      if (issue) {
        return issue;
      }
      if (
        rule.kind === 'compare' &&
        rule.left.kind === 'variable' &&
        rule.left.id.startsWith('app..')
      ) {
        return 'Choose an app';
      }
    }
    return undefined;
  });
  const canSave = $derived(dirty && !firstIssue);

  $effect(() => {
    if (!open) {
      loadedPageId = '';
      return;
    }
    if (loadedPageId === page.id) {
      return;
    }
    loadedPageId = page.id;
    rules = clonePlain(page.autoSwitch?.rules ?? []);
    returnOnLeave = page.autoSwitch?.returnOnLeave ?? true;
  });

  function addRule() {
    rules = [
      ...rules,
      {
        kind: 'compare',
        left: { kind: 'variable', id: pendingAppVariable('focused') },
        op: 'eq',
        right: { kind: 'literal', value: true },
      },
    ];
  }

  function updateRule(index: number, next: Predicate) {
    rules = rules.map((entry, i) => (i === index ? next : entry));
  }

  function moveRule(index: number, direction: -1 | 1) {
    const next = [...rules];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    rules = next;
  }

  function removeRule(index: number) {
    rules = rules.filter((_, i) => i !== index);
  }

  function save() {
    if (!canSave) {
      return;
    }
    setPageAutoSwitch(page.id, rules.length ? { rules, returnOnLeave } : undefined);
    open = false;
  }

  /** Ctrl+Z belongs to inputs inside the modal, not to the panel's undo history. */
  function keydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.stopPropagation();
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    aria-describedby={undefined}
    onkeydown={keydown}
    class="flex max-h-[min(680px,calc(100dvh-48px))] w-[min(640px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 data-closed:scale-100 transition-opacity motion-reduce:transition-none"
  >
    <Dialog.Header class="flex h-12 shrink-0 flex-row items-center gap-3 px-5">
      <Dialog.Title class="shrink-0 text-left">Auto-switch</Dialog.Title>
      <span class="min-w-0 truncate text-sm text-muted-foreground">{page.name}</span>
    </Dialog.Header>

    <div
      class="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-4 [scrollbar-gutter:stable]"
    >
      {#if rules.length}
        <Row
          label="Return when inactive"
          for="autoswitch-return"
        >
          <Switch
            id="autoswitch-return"
            bind:checked={returnOnLeave}
          />
        </Row>
      {/if}
      {#each rules as rule, index (index)}
        <div class="grid gap-3 rounded-xl bg-card p-3">
          <div class="flex items-center gap-1">
            <h3 class="min-w-0 flex-1 text-sm font-semibold">Rule {index + 1}</h3>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Move rule up"
              disabled={index === 0}
              onclick={() => moveRule(index, -1)}
            >
              <ArrowUp />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Move rule down"
              disabled={index === rules.length - 1}
              onclick={() => moveRule(index, 1)}
            >
              <ArrowDown />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Remove rule"
              onclick={() => removeRule(index)}
            >
              <Trash />
            </Button>
          </div>
          <ConditionEditor
            condition={rule}
            onchange={(next) => updateRule(index, next)}
          />
        </div>
      {/each}
      <Button
        variant="outline"
        onclick={addRule}
      >
        <Plus /> Add rule
      </Button>
    </div>

    <Dialog.Footer
      class="mx-0 mb-0 flex min-h-14 shrink-0 items-center justify-between gap-3 px-5 py-3"
    >
      <div
        class="min-w-0 flex-1"
        aria-live="polite"
      >
        {#if firstIssue}
          <span class="text-sm text-destructive">{firstIssue}</span>
        {/if}
      </div>
      <div class="flex shrink-0 gap-2">
        <Dialog.Close>
          <Button
            variant="ghost"
            size="sm"
          >
            Cancel
          </Button>
        </Dialog.Close>
        <Button
          size="sm"
          disabled={!canSave}
          onclick={save}
        >
          Save
        </Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

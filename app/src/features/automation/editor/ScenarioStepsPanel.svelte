<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import Choice from '../../plugins/ui/Choice.svelte';
  import AppStateField from '../../apps/ui/AppStateField.svelte';
  import StepList from './StepList.svelte';
  import type { StepListPath } from './scenario-edit';
  import type { ScenarioDraftEditor } from './scenario-draft.svelte';
  import StateSwatch from '../../controls/editor/StateSwatch.svelte';

  let { editor }: { editor: ScenarioDraftEditor } = $props();

  const draft = $derived(editor.draft!);
  const owner = $derived(editor.owner);
  const overrides = $derived(Object.keys(editor.currentList?.byState ?? {}));

  /** The parameter filter offers the event's suggestions plus a saved value no longer suggested. */
  const parameterOptions = $derived.by(() => {
    const selected = editor.selectedEvent;
    if (!selected) {
      return [];
    }
    const definition = editor.eventDefinition(selected.eventId);
    const suggestions =
      typeof definition?.parameterSuggestions === 'function'
        ? definition.parameterSuggestions()
        : (definition?.parameterSuggestions ?? []);
    const saved = selected.parameter;
    const missing = saved && !suggestions.some((option) => option.value === saved);
    return [
      { value: '', label: 'Any parameter' },
      ...suggestions,
      ...(missing ? [{ value: saved, label: saved, unavailable: true }] : []),
    ];
  });

  function stateLabel(index: number) {
    return index < 0 ? 'Unavailable' : editor.stateTitle(draft.variants[index], index);
  }
</script>

{#snippet steps(path: StepListPath)}
  <StepList
    {draft}
    {path}
    pickerKey={editor.pickerKey}
    onpickerchange={(value) => (editor.pickerKey = value)}
    onchange={(value) => editor.update(value)}
  />
{/snippet}

{#if editor.selectedEvent}
  <div class="grid shrink-0 gap-1.5 px-4 py-3">
    <Label class="text-xs text-muted-foreground">Parameter filter</Label>
    <Choice
      value={editor.selectedEvent.parameter ?? ''}
      placeholder="Any parameter"
      options={parameterOptions}
      onchange={(value) => editor.changeEventParameter(value)}
    />
    {#if editor.selectedEvent.eventId === 'variables.changed'}
      <Label class="text-xs text-muted-foreground">App</Label>
      <AppStateField
        value={editor.selectedEvent.parameter ?? ''}
        onchange={(value) => editor.changeEventParameter(value)}
      />
    {/if}
  </div>
{/if}
<div
  class="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 [overflow-anchor:none] [scrollbar-gutter:stable]"
>
  {#if editor.hasOverride}
    <div class="mb-3 flex justify-end">
      <Button
        variant="ghost"
        size="sm"
        onclick={() => editor.clearOverride()}
      >
        Remove override
      </Button>
    </div>
  {/if}
  {#if !owner}
    <!-- No trigger is selected. -->
  {:else if editor.selectedState !== '*' && !editor.hasOverride}
    <Button
      variant="outline"
      size="sm"
      onclick={() => editor.makeOverride()}
    >
      Override common steps
    </Button>
  {:else if editor.selectedState === '*' && overrides.length}
    <div class="grid min-w-0 gap-3">
      <section
        class="grid min-w-0 gap-3"
        aria-label="Common steps"
      >
        <div class="flex min-w-0 items-center">
          <span class="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">Common</span>
        </div>
        {@render steps(owner)}
      </section>
      {#each overrides as stateId (stateId)}
        {@const index = editor.stateIndex(stateId)}
        {@const label = stateLabel(index)}
        <section
          class="grid min-w-0 gap-3"
          aria-label={index < 0 ? 'Unavailable state steps' : `${label} steps`}
        >
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            {#if index >= 0}<StateSwatch appearance={draft.variants[index]} />{/if}
            <span class="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{label}</span>
            {#if index < 0}
              <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{stateId}</span>
            {:else if draft.variants[index].label}
              <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {draft.variants[index].label}
              </span>
            {/if}
            <Button
              variant="ghost"
              size="sm"
              onclick={() => editor.clearOverride(stateId)}
            >
              Clear override
            </Button>
          </div>
          {@render steps({ ...owner, stateId })}
        </section>
      {/each}
    </div>
  {:else if editor.currentPath}
    {@render steps(editor.currentPath)}
  {/if}
</div>

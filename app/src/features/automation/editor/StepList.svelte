<script lang="ts">
  import { onDestroy } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { sortable } from '$lib/sortable/sortable';
  import Plus from '@lucide/svelte/icons/plus';
  import { Button } from '$lib/components/ui/button';
  import { runtimeView } from '../../../app/runtime/state';
  import {
    MAX_SCENARIO_DEPTH,
    MAX_SCENARIO_NODES,
    scenarioNodeCount,
    type ActionStep,
  } from '../scenario';
  import StepCard from './StepCard.svelte';
  import StepList from './StepList.svelte';
  import StepPicker from './StepPicker.svelte';
  import { stepDrop, stepDropTarget } from './step-drop';
  import { scrollParent, StepLayoutMotion } from './step-layout';
  import {
    insertScenarioStep,
    moveScenarioStep,
    moveScenarioStepTo,
    removeScenarioStep,
    replaceScenarioStep,
    scenarioPathKey,
    scenarioStepsAt,
    shiftScenarioStep,
    type ScenarioDraft,
    type StepListPath,
  } from './scenario-edit';

  let {
    draft,
    path,
    depth = 1,
    pickerKey,
    onpickerchange,
    onchange,
  }: {
    draft: ScenarioDraft;
    path: StepListPath;
    depth?: number;
    pickerKey: string | null;
    onpickerchange: (key: string | null) => void;
    onchange: (draft: ScenarioDraft) => void;
  } = $props();
  const steps = $derived(scenarioStepsAt(draft.scenario, path));
  const listKey = $derived(scenarioPathKey(path));
  const atLimit = $derived(
    depth > MAX_SCENARIO_DEPTH || scenarioNodeCount(draft.scenario) >= MAX_SCENARIO_NODES,
  );
  const conditionStateId = $derived(path.stateId ?? draft.variants[0]?.id ?? 'state-1');
  let listNode = $state<HTMLElement>();
  let pickerOpener: HTMLElement | null = null;
  let pickerRowId = '';
  let pickerAbove = $state(false);
  let pickerHeight = $state(360);
  let highlightedId = $state('');
  let highlightTimer: ReturnType<typeof setTimeout>;
  const motion = new StepLayoutMotion();
  const rows = () => [
    ...(listNode?.querySelectorAll<HTMLElement>(':scope > [data-step-row]') ?? []),
  ];
  const addKey = (index: number) => `${listKey}:add:${index}`;
  const replaceKey = (id: string) => `${listKey}:replace:${id}`;

  function changeLayout(change: () => void) {
    return motion.change(listNode, change);
  }

  function updateScenario(scenario: ScenarioDraft['scenario']) {
    void changeLayout(() => onchange({ ...draft, scenario }));
  }

  async function chooseStep(step: ActionStep, index: number, current?: ActionStep) {
    // Picking the current action must preserve its arguments and nested branches.
    if (
      current &&
      current.kind === step.kind &&
      (current.kind !== 'action' ||
        (step.kind === 'action' && current.action.id === step.action.id))
    ) {
      closePicker();
      return;
    }
    highlightedId = current?.id ?? step.id;
    await changeLayout(() => {
      onchange({
        ...draft,
        scenario: current
          ? replaceScenarioStep(draft.scenario, path, current.id, step)
          : insertScenarioStep(draft.scenario, path, step, index),
      });
      if (current) {
        onpickerchange(null);
      }
    });
    const node = rows().find((row) => row.dataset.stepId === highlightedId);
    if (!current) {
      node?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
    node?.focus({ preventScroll: true });
    if (!current) {
      onpickerchange(null);
    }
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => (highlightedId = ''), 1000);
  }

  async function closePicker() {
    await changeLayout(() => onpickerchange(null));
    const target = pickerRowId
      ? rows()
          .find((row) => row.dataset.stepId === pickerRowId)
          ?.querySelector<HTMLElement>('[data-step-change]')
      : pickerOpener;
    if (target?.isConnected) {
      target.focus({ preventScroll: true });
    }
  }

  async function openPicker(event: MouseEvent, key: string) {
    pickerOpener = event.currentTarget as HTMLElement;
    pickerRowId = key.includes(':replace:')
      ? (pickerOpener.closest<HTMLElement>('[data-step-row]')?.dataset.stepId ?? '')
      : '';
    pickerOpener.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const rect = pickerOpener.getBoundingClientRect();
    const viewport = scrollParent(pickerOpener).getBoundingClientRect();
    const above = rect.top - viewport.top - 8,
      below = viewport.bottom - rect.bottom - 8;
    pickerAbove = below < 300 && above > below;
    pickerHeight = Math.max(140, pickerAbove ? above : below);
    await changeLayout(() => onpickerchange(key));
    listNode?.parentElement
      ?.querySelector<HTMLInputElement>('[data-step-picker] input')
      ?.focus({ preventScroll: true });
  }

  function stepEnter(_node: Element, { id }: { id: string }) {
    return {
      duration: prefersReducedMotion.current || highlightedId !== id ? 0 : 180,
      css: (t: number) => `opacity: ${t}; transform: translateY(${6 * (1 - t)}px)`,
    };
  }

  function bindVariable(id: string) {
    const record = $runtimeView.variables.records[id];
    if (!record) {
      return;
    }
    const existing = draft.stateBindings ?? [];
    if (existing.some((binding) => binding.variableId === id)) {
      return;
    }
    const cases =
      record.definition.type === 'boolean' && draft.stateRoles && !existing.length
        ? [
            { value: false, stateId: draft.stateRoles.off },
            { value: true, stateId: draft.stateRoles.on },
          ]
        : [];
    onchange({ ...draft, stateBindings: [...existing, { variableId: id, cases }] });
  }

  function move(stepId: string, amount: number) {
    const index = steps.findIndex((step) => step.id === stepId);
    const destination = Math.max(0, Math.min(steps.length - 1, index + amount));
    if (index >= 0 && index !== destination) {
      updateScenario(moveScenarioStep(draft.scenario, path, stepId, destination));
    }
  }

  /** Alt+Arrow: through the Then and Else lists around the step, then back to the handle that moved. */
  async function shift(stepId: string, direction: -1 | 1) {
    const scenario = shiftScenarioStep(draft.scenario, path, stepId, direction);
    if (!scenario) {
      return;
    }
    await changeLayout(() => onchange({ ...draft, scenario }));
    document
      .querySelector<HTMLElement>(`[data-step-id="${CSS.escape(stepId)}"] [data-step-handle]`)
      ?.focus({ preventScroll: true });
  }

  function dropInto(from: number, zone: HTMLElement) {
    const step = steps[from];
    const target = stepDropTarget(zone);
    if (step && target) {
      updateScenario(moveScenarioStepTo(draft.scenario, path, step.id, target.path, target.index));
    }
  }

  function reorder(from: number, to: number) {
    const step = steps[from];
    if (step) {
      onchange({ ...draft, scenario: moveScenarioStep(draft.scenario, path, step.id, to) });
    }
  }

  onDestroy(() => {
    clearTimeout(highlightTimer);
    motion.destroy();
  });
</script>

{#snippet picker(index: number, current?: ActionStep)}
  <StepPicker
    {current}
    {depth}
    height={pickerHeight}
    stateId={conditionStateId}
    onchoose={(step) => chooseStep(step, index, current)}
    onclose={closePicker}
  />
{/snippet}

{#snippet insertion(index: number, end = false)}
  <div
    data-step-insert
    class={end ? 'relative' : 'absolute inset-x-0 -top-8 h-7'}
  >
    <div
      use:stepDrop={{ path, index }}
      class="visible absolute inset-0 z-1 hidden rounded-md border border-dashed border-border bg-card data-drop-over:border-ring data-drop-over:bg-accent data-drop-ready:block"
    ></div>
    <Button
      variant={end ? 'secondary' : 'ghost'}
      size="sm"
      class={end ? 'w-full' : 'h-6 w-full text-xs text-muted-foreground'}
      disabled={atLimit}
      aria-label={end ? 'Add step' : `Insert step before step ${index + 1}`}
      aria-expanded={pickerKey === addKey(index)}
      onclick={(event) => openPicker(event, addKey(index))}
    >
      <Plus />{end ? 'Add step' : 'Insert here'}
    </Button>
    {#if pickerKey === addKey(index)}
      <div class="absolute inset-x-0 z-30 {pickerAbove ? 'bottom-full mb-1' : 'top-full mt-1'}">
        {@render picker(index)}
      </div>
    {/if}
  </div>
{/snippet}

<div class="grid min-w-0 gap-3">
  <div
    bind:this={listNode}
    use:sortable={{
      axis: 'y',
      items: rows,
      handle: '[data-step-handle]',
      enabled: !pickerKey,
      onmove: reorder,
      drop: {
        selector: '[data-step-drop]',
        accept: (zone) => {
          const target = stepDropTarget(zone);
          return !!target && scenarioPathKey(target.path) !== listKey;
        },
        ondrop: dropInto,
      },
    }}
    role="list"
    aria-label="Scenario steps"
    class="grid min-w-0 gap-9 {steps.length ? 'pt-8' : depth === 0 ? 'watermark h-40' : ''}"
    data-kana="ステップ"
  >
    {#each steps as step, index (step.id)}
      {#snippet replacePicker()}
        {@render picker(index, step)}
      {/snippet}
      {#snippet branch(arm: 'then' | 'else')}
        <StepList
          {draft}
          depth={depth + 1}
          {pickerKey}
          {onpickerchange}
          {onchange}
          path={{ ...path, branches: [...(path.branches ?? []), { stepId: step.id, arm }] }}
        />
      {/snippet}
      <div
        data-step-row
        data-step-id={step.id}
        role="listitem"
        tabindex="-1"
        in:stepEnter={{ id: step.id }}
        class="relative grid min-w-0 gap-3 rounded-xl bg-card p-3 outline-none data-sortable-active:shadow-lg data-sortable-active:ring-1 data-sortable-active:ring-ring/40 {highlightedId ===
        step.id
          ? 'shadow-[inset_2px_0_0_var(--ring)]'
          : ''}"
      >
        {@render insertion(index)}
        <StepCard
          {step}
          {index}
          count={steps.length}
          locked={!!pickerKey}
          picker={pickerKey === replaceKey(step.id) ? replacePicker : undefined}
          {branch}
          onmove={(amount) => move(step.id, amount)}
          onshift={(direction) => shift(step.id, direction)}
          onremove={() => updateScenario(removeScenarioStep(draft.scenario, path, step.id))}
          onupdate={(next) =>
            updateScenario(replaceScenarioStep(draft.scenario, path, step.id, next))}
          onbind={bindVariable}
          onpick={(event) => openPicker(event, replaceKey(step.id))}
        />
      </div>
    {/each}
  </div>

  {@render insertion(steps.length, true)}
</div>

<style>
  :global([data-sorting]) [data-step-insert] {
    visibility: hidden;
  }
</style>

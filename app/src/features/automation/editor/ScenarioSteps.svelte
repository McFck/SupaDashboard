<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { sortable } from '$lib/sortable';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { actions } from '../../plugins/registry';
  import { runtimeView } from '../../../app/runtime/state';
  import { newId, scenarioNodeCount, type ActionStep, type Predicate } from '../scenario';
  import ConditionEditor from './ConditionEditor.svelte';
  import ScenarioSteps from './ScenarioSteps.svelte';
  import ActionPicker from './ActionPicker.svelte';
  import ParamField from '../../plugins/ui/ParamField.svelte';
  import PluginMark from '../../plugins/ui/PluginMark.svelte';
  import {
    insertScenarioStep,
    moveScenarioStep,
    removeScenarioStep,
    replaceScenarioStep,
    scenarioPathKey,
    scenarioStepsAt,
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
  const totalNodes = $derived(scenarioNodeCount(draft.scenario));
  const atLimit = $derived(depth > 16 || totalNodes >= 1000);
  let listNode = $state<HTMLElement>();
  let pickerOpener: HTMLElement | null = null;
  let pickerRowId = '';
  let pickerAbove = $state(false);
  let pickerHeight = $state(360);
  let highlightedId = $state('');
  let highlightTimer: ReturnType<typeof setTimeout>;
  const layoutAnimations = new Map<HTMLElement, Animation>();
  const rows = () => [
    ...(listNode?.querySelectorAll<HTMLElement>(':scope > [data-step-row]') ?? []),
  ];
  const addKey = (index: number) => `${listKey}:add:${index}`;
  const replaceKey = (id: string) => `${listKey}:replace:${id}`;

  async function changeLayout(change: () => void) {
    const cards = [
      ...(listNode
        ?.closest('[role="tabpanel"]')
        ?.querySelectorAll<HTMLElement>('[data-step-row]') ?? []),
    ];
    const scroll = listNode ? scrollParent(listNode) : undefined;
    const before = cards.map((node) => ({
      node,
      y: node.getBoundingClientRect().top + (scroll?.scrollTop ?? 0),
    }));
    for (const node of cards) layoutAnimations.get(node)?.cancel();
    change();
    await tick();
    if (prefersReducedMotion.current) return;
    const deltas = new Map(
      before
        .filter(({ node }) => node.isConnected)
        .map(({ node, y }) => [
          node,
          y - node.getBoundingClientRect().top - (scroll?.scrollTop ?? 0),
        ]),
    );
    for (const [node, delta] of deltas) {
      // A nested list inherits its parent card's translation; animate only its own displacement.
      const parent = node.parentElement?.closest<HTMLElement>('[data-step-row]');
      const y = delta - (parent ? (deltas.get(parent) ?? 0) : 0);
      if (!y) continue;
      const animation = node.animate(
        [{ transform: `translateY(${y}px)` }, { transform: 'translateY(0px)' }],
        { duration: 180, easing: 'ease-out' },
      );
      layoutAnimations.set(node, animation);
      const finished = () => {
        if (layoutAnimations.get(node) === animation) layoutAnimations.delete(node);
      };
      void animation.finished.then(finished, finished);
    }
  }
  function updateScenario(scenario: ScenarioDraft['scenario']) {
    void changeLayout(() => onchange({ ...draft, scenario }));
  }
  function actionStep(id: string): ActionStep {
    const definition = actions.get(id);
    const args = Object.fromEntries(
      (definition?.params ?? [])
        .filter((param) => param.default !== undefined)
        .map((param) => [param.key, structuredClone(param.default)]),
    );
    return { id: newId(), kind: 'action', action: { id, args } };
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
      if (current) onpickerchange(null);
    });
    const node = rows().find((row) => row.dataset.stepId === highlightedId);
    if (!current) node?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    node?.focus({ preventScroll: true });
    if (!current) onpickerchange(null);
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => (highlightedId = ''), 1000);
  }
  function waitStep(): ActionStep {
    return { id: newId(), kind: 'delay', ms: 200 };
  }
  function conditionStep(): ActionStep {
    const condition: Predicate = {
      kind: 'compare',
      left: { kind: 'state', controlId: 'self' },
      op: 'eq',
      right: { kind: 'literal', value: path.stateId ?? draft.variants[0]?.id ?? 'state-1' },
    };
    return { id: newId(), kind: 'if', condition, then: [], else: [] };
  }
  async function closePicker() {
    await changeLayout(() => onpickerchange(null));
    const target = pickerRowId
      ? rows()
          .find((row) => row.dataset.stepId === pickerRowId)
          ?.querySelector<HTMLElement>('[data-step-change]')
      : pickerOpener;
    if (target?.isConnected) target.focus({ preventScroll: true });
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
    pickerHeight = Math.max(140, Math.min(360, pickerAbove ? above : below));
    await changeLayout(() => onpickerchange(key));
    listNode?.parentElement
      ?.querySelector<HTMLInputElement>('[data-step-picker] input')
      ?.focus({ preventScroll: true });
  }
  function scrollParent(node: HTMLElement) {
    let parent = node.parentElement;
    while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY))
      parent = parent.parentElement;
    return parent ?? document.documentElement;
  }
  function stepEnter(_node: Element, { id }: { id: string }) {
    return {
      duration: prefersReducedMotion.current || highlightedId !== id ? 0 : 180,
      css: (t: number) => `opacity: ${t}; transform: translateY(${6 * (1 - t)}px)`,
    };
  }
  function bodyFade(node: HTMLElement, { out = false }: { out?: boolean } = {}) {
    // Remove the old body from flow before FLIP measures the new layout, not on the next animation frame.
    if (out) {
      node.style.position = 'absolute';
      node.style.inset = '0';
      node.style.pointerEvents = 'none';
    }
    return {
      duration: prefersReducedMotion.current ? 0 : 120,
      css: (t: number) => `opacity: ${t}`,
    };
  }
  function updateAction(stepId: string, ref: { id: string; args?: Record<string, unknown> }) {
    const step = steps.find((value) => value.id === stepId);
    if (!step || step.kind !== 'action') return;
    updateScenario(replaceScenarioStep(draft.scenario, path, stepId, { ...step, action: ref }));
  }
  function updateDelay(step: Extract<ActionStep, { kind: 'delay' }>, raw: string) {
    const ms = raw === '' ? 0 : Number(raw);
    if (Number.isInteger(ms))
      updateScenario(replaceScenarioStep(draft.scenario, path, step.id, { ...step, ms }));
  }
  function updateCondition(step: Extract<ActionStep, { kind: 'if' }>, condition: Predicate) {
    updateScenario(replaceScenarioStep(draft.scenario, path, step.id, { ...step, condition }));
  }
  function bindingSuggestion(step: ActionStep) {
    if (step.kind !== 'action') return undefined;
    try {
      return actions.get(step.action.id)?.bindableVariable?.(step.action.args ?? {});
    } catch {
      return undefined;
    }
  }
  function bindVariable(id: string) {
    const record = $runtimeView.variables.records[id];
    if (!record) return;
    const cases =
      record.definition.type === 'boolean' && draft.stateRoles
        ? [
            { value: false, stateId: draft.stateRoles.off },
            { value: true, stateId: draft.stateRoles.on },
          ]
        : [];
    onchange({ ...draft, stateBinding: { variableId: id, cases } });
  }
  function move(stepId: string, amount: number) {
    const index = steps.findIndex((step) => step.id === stepId);
    const destination = Math.max(0, Math.min(steps.length - 1, index + amount));
    if (index >= 0 && index !== destination)
      updateScenario(moveScenarioStep(draft.scenario, path, stepId, destination));
  }
  function reorder(from: number, to: number) {
    const step = steps[from];
    if (step) onchange({ ...draft, scenario: moveScenarioStep(draft.scenario, path, step.id, to) });
  }
  onDestroy(() => {
    clearTimeout(highlightTimer);
    for (const animation of layoutAnimations.values()) animation.cancel();
  });
  function pickerKeyboard(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePicker();
    }
  }
</script>

{#snippet stepPicker(index: number, current?: ActionStep)}
  <div
    data-step-picker
    role="dialog"
    tabindex="-1"
    aria-label={current ? 'Change step' : 'Add step'}
    onkeydown={pickerKeyboard}
    class="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain rounded-lg border bg-popover p-3 shadow-lg [scrollbar-gutter:stable]"
    style:height={`${pickerHeight}px`}
  >
    <div class="flex shrink-0 flex-wrap items-center gap-1">
      <span class="mr-auto text-xs font-semibold">{current ? 'Change step' : 'Add step'}</span>
      <Button
        size="sm"
        variant={current?.kind === 'action' || !current ? 'secondary' : 'ghost'}
        onclick={(event) =>
          event.currentTarget.closest('[data-step-picker]')?.querySelector('input')?.focus()}
        >Action</Button
      >
      <Button
        size="sm"
        variant={current?.kind === 'delay' ? 'secondary' : 'ghost'}
        onclick={() => chooseStep(waitStep(), index, current)}>Wait</Button
      >
      <Button
        size="sm"
        variant={current?.kind === 'if' ? 'secondary' : 'ghost'}
        disabled={depth >= 16}
        onclick={() => chooseStep(conditionStep(), index, current)}>Condition</Button
      >
      <Button
        size="sm"
        variant="ghost"
        aria-label="Close step picker"
        onclick={closePicker}>Close</Button
      >
    </div>
    <ActionPicker
      inline
      value={current?.kind === 'action' ? current.action.id : ''}
      onpick={(id) => chooseStep(actionStep(id), index, current)}
    />
  </div>
{/snippet}

{#snippet insertion(index: number, end = false)}
  <div
    data-step-insert
    class={end ? 'relative' : 'absolute inset-x-0 -top-8 h-7'}
  >
    <Button
      variant={end ? 'outline' : 'ghost'}
      size="sm"
      class={end ? 'w-full border-dashed' : 'h-6 w-full text-xs text-muted-foreground'}
      disabled={atLimit}
      aria-label={end ? 'Add step' : `Insert step before step ${index + 1}`}
      aria-expanded={pickerKey === addKey(index)}
      onclick={(event) => openPicker(event, addKey(index))}
    >
      <Plus />{end ? 'Add step' : 'Insert here'}
    </Button>
    {#if pickerKey === addKey(index)}
      <div class="absolute inset-x-0 z-30 {pickerAbove ? 'bottom-full mb-1' : 'top-full mt-1'}">
        {@render stepPicker(index)}
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
    }}
    role="list"
    aria-label="Scenario steps"
    class="grid min-w-0 gap-9 {steps.length ? 'pt-8' : ''}"
  >
    {#each steps as step, index (step.id)}
      {@const suggestedVariableId = bindingSuggestion(step)}
      {@const suggestedVariable = suggestedVariableId
        ? $runtimeView.variables.records[suggestedVariableId]
        : undefined}
      <div
        data-step-row
        data-step-id={step.id}
        role="listitem"
        tabindex="-1"
        in:stepEnter={{ id: step.id }}
        class="relative grid min-w-0 gap-3 rounded-xl border bg-card p-3 outline-none data-sortable-active:shadow-lg data-sortable-active:ring-1 data-sortable-active:ring-ring/40 {highlightedId ===
        step.id
          ? 'ring-2 ring-ring/60'
          : ''}"
      >
        {@render insertion(index)}
        <div class="flex min-w-0 items-center gap-2">
          <button
            data-step-handle
            type="button"
            aria-label="Reorder step"
            disabled={steps.length < 2 || !!pickerKey}
            class="grid size-8 shrink-0 touch-none place-items-center rounded text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40"
            onkeydown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                move(step.id, -1);
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                move(step.id, 1);
              }
            }}><GripVertical class="size-4" /></button
          >
          <span class="min-w-0 flex-1 truncate text-sm font-medium">
            {#if step.kind === 'action'}{actions.get(step.action.id)?.title ?? step.action.id}
            {:else if step.kind === 'delay'}Wait
            {:else}Condition{/if}
          </span>
          {#if step.kind === 'action' && !actions.has(step.action.id)}<span
              class="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >Unavailable</span
            >{/if}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Move step up"
            disabled={index === 0}
            onclick={() => move(step.id, -1)}><ArrowUp /></Button
          >
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Move step down"
            disabled={index === steps.length - 1}
            onclick={() => move(step.id, 1)}><ArrowDown /></Button
          >
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove step"
            onclick={() => updateScenario(removeScenarioStep(draft.scenario, path, step.id))}
            ><Trash /></Button
          >
        </div>

        <div class="relative min-w-0">
          {#key pickerKey === replaceKey(step.id) ? 'picker' : step.kind === 'action' ? step.action.id : step.kind}
            <div
              class="grid min-w-0 gap-3"
              in:bodyFade
              out:bodyFade={{ out: true }}
            >
              {#if pickerKey === replaceKey(step.id)}
                {@render stepPicker(index, step)}
              {:else}
                {#if step.kind === 'action'}
                  {#if actions.has(step.action.id)}
                    <div class="grid gap-3 border-l-2 border-white/10 pl-3">
                      {#each actions.get(step.action.id)?.params ?? [] as param (param.key)}
                        <ParamField
                          {param}
                          provider={actions.get(step.action.id)?.plugin}
                          args={step.action.args ?? {}}
                          value={step.action.args?.[param.key]}
                          onchange={(value) =>
                            updateAction(step.id, {
                              ...step.action,
                              args: { ...step.action.args, [param.key]: value },
                            })}
                        />
                      {/each}
                    </div>
                  {/if}
                {:else if step.kind === 'delay'}
                  <div class="grid max-w-56 gap-1.5">
                    <Label class="text-xs text-muted-foreground">Wait duration (ms)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="86400000"
                      step="1"
                      value={step.ms}
                      oninput={(event) => updateDelay(step, event.currentTarget.value)}
                    />
                  </div>
                {:else}
                  <ConditionEditor
                    condition={step.condition}
                    onchange={(condition) => updateCondition(step, condition)}
                  />
                  <div class="grid gap-2 rounded-lg border bg-background/30 p-2">
                    <h4 class="text-xs font-semibold text-muted-foreground">Then</h4>
                    <ScenarioSteps
                      {draft}
                      depth={depth + 1}
                      {pickerKey}
                      {onpickerchange}
                      {onchange}
                      path={{
                        ...path,
                        branches: [...(path.branches ?? []), { stepId: step.id, arm: 'then' }],
                      }}
                    />
                  </div>
                  <div class="grid gap-2 rounded-lg border bg-background/30 p-2">
                    <h4 class="text-xs font-semibold text-muted-foreground">Else</h4>
                    <ScenarioSteps
                      {draft}
                      depth={depth + 1}
                      {pickerKey}
                      {onpickerchange}
                      {onchange}
                      path={{
                        ...path,
                        branches: [...(path.branches ?? []), { stepId: step.id, arm: 'else' }],
                      }}
                    />
                  </div>
                {/if}
                <Button
                  data-step-change
                  variant="outline"
                  size="sm"
                  class="w-fit"
                  onclick={(event) => openPicker(event, replaceKey(step.id))}
                  >{step.kind === 'action' ? 'Replace action' : 'Change step'}</Button
                >
                {#if step.kind === 'action'}
                  {#if suggestedVariable}
                    <Button
                      variant="outline"
                      size="sm"
                      class="w-fit"
                      onclick={() => bindVariable(suggestedVariableId!)}
                    >
                      Bind {suggestedVariable.definition.name} to state <PluginMark
                        plugin={suggestedVariable.definition.owner}
                      />
                    </Button>
                  {/if}
                {/if}
              {/if}
            </div>
          {/key}
        </div>
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

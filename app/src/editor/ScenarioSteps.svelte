<script lang="ts">
  import { flip } from 'svelte/animate';
  import { prefersReducedMotion } from 'svelte/motion';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { actions } from '../core/registry';
  import { runtimeView } from '../core/runtime.svelte';
  import { newScenarioId, type ActionStep, type Predicate, type Scalar } from '../core/scenario';
  import ConditionEditor from './ConditionEditor.svelte';
  import ScenarioSteps from './ScenarioSteps.svelte';
  import ActionPicker from './ActionPicker.svelte';
  import ParamField from './ParamField.svelte';
  import PluginMark from './PluginMark.svelte';
  import { insertScenarioStep, moveScenarioStep, removeScenarioStep, replaceScenarioStep,
    scenarioNodeCount, scenarioPathKey, scenarioStepsAt, type ScenarioDraft, type StepListPath } from './scenario-edit';

  let { draft, path, depth = 1, pickerKey, onpickerchange, onchange }: {
    draft: ScenarioDraft; path: StepListPath; depth?: number; pickerKey: string | null;
    onpickerchange: (key: string | null) => void; onchange: (draft: ScenarioDraft) => void;
  } = $props();
  const steps = $derived(scenarioStepsAt(draft.scenario, path));
  const listKey = $derived(scenarioPathKey(path));
  const totalNodes = $derived(scenarioNodeCount(draft.scenario));
  const atLimit = $derived(depth >= 16 || totalNodes >= 1000);
  const addKey = $derived(`${listKey}:add`);
  let adding = $state(false);
  let addingAction = $state(false);
  let listNode = $state<HTMLElement>();
  let drag = $state<{ id: string; pointerId: number; startY: number; destination: number; node: HTMLElement;
    midpoints: number[] } | null>(null);

  function updateScenario(scenario: ScenarioDraft['scenario']) { onchange({ ...draft, scenario }); }
  function addAction(id: string) {
    const definition = actions.get(id);
    const args = Object.fromEntries((definition?.params ?? []).filter(param => param.default !== undefined)
      .map(param => [param.key, structuredClone(param.default)]));
    updateScenario(insertScenarioStep(draft.scenario, path, { id: newScenarioId(), kind: 'action', action: { id, args } }));
    adding = false;
    addingAction = false;
    onpickerchange(null);
  }
  function replaceAction(stepId: string, id: string) {
    const definition = actions.get(id);
    const args = Object.fromEntries((definition?.params ?? []).filter(param => param.default !== undefined)
      .map(param => [param.key, structuredClone(param.default)]));
    updateScenario(replaceScenarioStep(draft.scenario, path, stepId,
      { id: stepId, kind: 'action', action: { id, args } }));
    onpickerchange(null);
  }
  function addWait() {
    updateScenario(insertScenarioStep(draft.scenario, path, { id: newScenarioId(), kind: 'delay', ms: 200 }));
    adding = false;
    onpickerchange(null);
  }
  function addCondition() {
    const condition: Predicate = { kind: 'compare', left: { kind: 'literal', value: '' }, op: 'eq', right: { kind: 'literal', value: true } };
    updateScenario(insertScenarioStep(draft.scenario, path, { id: newScenarioId(), kind: 'if', condition, then: [], else: [] }));
    adding = false;
    onpickerchange(null);
  }
  function updateAction(stepId: string, ref: { id: string; args?: Record<string, unknown> }) {
    const step = steps.find(value => value.id === stepId);
    if (!step || step.kind !== 'action') return;
    updateScenario(replaceScenarioStep(draft.scenario, path, stepId, { ...step, action: ref }));
  }
  function updateDelay(step: Extract<ActionStep, { kind: 'delay' }>, raw: string) {
    const ms = raw === '' ? 0 : Number(raw);
    if (Number.isInteger(ms)) updateScenario(replaceScenarioStep(draft.scenario, path, step.id, { ...step, ms }));
  }
  function updateCondition(step: Extract<ActionStep, { kind: 'if' }>, condition: Predicate) {
    updateScenario(replaceScenarioStep(draft.scenario, path, step.id, { ...step, condition }));
  }
  function bindingSuggestion(step: ActionStep) {
    if (step.kind !== 'action') return undefined;
    try { return actions.get(step.action.id)?.bindableVariable?.(step.action.args ?? {}); }
    catch { return undefined; }
  }
  function bindVariable(id: string) {
    const record = $runtimeView.variables.records[id];
    if (!record) return;
    const cases = record.definition.type === 'boolean' && draft.stateRoles ? [
      { value: false, stateId: draft.stateRoles.off }, { value: true, stateId: draft.stateRoles.on },
    ] : [];
    onchange({ ...draft, stateBinding: { variableId: id, cases } });
  }
  function move(stepId: string, amount: number) {
    const index = steps.findIndex(step => step.id === stepId);
    const destination = Math.max(0, Math.min(steps.length - 1, index + amount));
    if (index >= 0 && index !== destination) updateScenario(moveScenarioStep(draft.scenario, path, stepId, destination));
  }
  function beginDrag(event: PointerEvent, stepId: string) {
    if (event.button !== 0 || !listNode) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const rows = [...listNode.querySelectorAll<HTMLElement>(':scope > [data-step-row]')];
    const node = rows.find(row => row.dataset.stepId === stepId);
    if (!node) return;
    drag = { id: stepId, pointerId: event.pointerId, startY: event.clientY, destination: steps.findIndex(step => step.id === stepId),
      node, midpoints: rows.map(row => { const rect = row.getBoundingClientRect(); return rect.top + rect.height / 2; }) };
  }
  function moveDrag(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.destination = drag.midpoints.findIndex(midpoint => event.clientY < midpoint);
    if (drag.destination < 0) drag.destination = drag.midpoints.length - 1;
    drag.node.style.transform = `translateY(${event.clientY - drag.startY}px)`;
  }
  function finishDrag(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = drag;
    current.node.style.transform = '';
    drag = null;
    if (current.destination !== steps.findIndex(step => step.id === current.id))
      updateScenario(moveScenarioStep(draft.scenario, path, current.id, current.destination));
  }
  function cancelDrag(event?: PointerEvent) {
    if (!drag || event && drag.pointerId !== event.pointerId) return;
    drag.node.style.transform = '';
    drag = null;
  }
</script>

<div role="list" class="grid min-w-0 gap-2" onpointermove={moveDrag} onpointerup={finishDrag} onpointercancel={cancelDrag}>
  <div bind:this={listNode} class="grid min-w-0 gap-2">
    {#each steps as step, index (step.id)}
      {@const suggestedVariableId = bindingSuggestion(step)}
      {@const suggestedVariable = suggestedVariableId ? $runtimeView.variables.records[suggestedVariableId] : undefined}
      <div data-step-row data-step-id={step.id} animate:flip={{ duration: prefersReducedMotion.current ? 0 : 180 }}
        class="grid min-w-0 gap-3 rounded-xl border bg-card p-3">
        <div class="flex min-w-0 items-center gap-2">
          <button type="button" aria-label="Reorder step" disabled={steps.length < 2}
            class="grid size-8 shrink-0 touch-none place-items-center rounded text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40"
            onpointerdown={event => beginDrag(event, step.id)}
            onkeydown={event => { if (event.key === 'ArrowUp') { event.preventDefault(); move(step.id, -1); }
              if (event.key === 'ArrowDown') { event.preventDefault(); move(step.id, 1); } }}><GripVertical class="size-4" /></button>
          <span class="min-w-0 flex-1 truncate text-sm font-medium">
            {#if step.kind === 'action'}{actions.get(step.action.id)?.title ?? step.action.id}
            {:else if step.kind === 'delay'}Wait
            {:else}Condition{/if}
          </span>
          {#if step.kind === 'action' && !actions.has(step.action.id)}<span class="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Unavailable</span>{/if}
          <Button size="icon-sm" variant="ghost" aria-label="Move step up" disabled={index === 0} onclick={() => move(step.id, -1)}><ArrowUp /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Move step down" disabled={index === steps.length - 1} onclick={() => move(step.id, 1)}><ArrowDown /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Remove step" onclick={() => updateScenario(removeScenarioStep(draft.scenario, path, step.id))}><Trash /></Button>
        </div>

        {#if pickerKey === `${listKey}:replace:${step.id}` && step.kind === 'action'}
          <ActionPicker inline value={step.action.id} onpick={id => replaceAction(step.id, id)} />
        {:else if pickerKey !== `${listKey}:add`}
          {#if step.kind === 'action'}
            {#if actions.has(step.action.id)}
              <div class="grid gap-3 border-l-2 border-white/10 pl-3">
                {#each actions.get(step.action.id)?.params ?? [] as param (param.key)}
                  <ParamField {param} provider={actions.get(step.action.id)?.plugin} args={step.action.args ?? {}} value={step.action.args?.[param.key]}
                    onchange={value => updateAction(step.id, { ...step.action, args: { ...step.action.args, [param.key]: value } })} />
                {/each}
              </div>
            {/if}
          {:else if step.kind === 'delay'}
            <div class="grid max-w-56 gap-1.5">
              <Label class="text-xs text-muted-foreground">Wait duration (ms)</Label>
              <Input type="number" min="0" max="86400000" step="1" value={step.ms}
                oninput={event => updateDelay(step, event.currentTarget.value)} />
            </div>
          {:else}
            <ConditionEditor condition={step.condition} onchange={condition => updateCondition(step, condition)} />
            <div class="grid gap-2 rounded-lg border bg-background/30 p-2">
              <h4 class="text-xs font-semibold text-muted-foreground">Then</h4>
              <ScenarioSteps {draft} depth={depth + 1} {pickerKey} {onpickerchange} {onchange}
                path={{ ...path, branches: [...(path.branches ?? []), { stepId: step.id, arm: 'then' }] }} />
            </div>
            <div class="grid gap-2 rounded-lg border bg-background/30 p-2">
              <h4 class="text-xs font-semibold text-muted-foreground">Else</h4>
              <ScenarioSteps {draft} depth={depth + 1} {pickerKey} {onpickerchange} {onchange}
                path={{ ...path, branches: [...(path.branches ?? []), { stepId: step.id, arm: 'else' }] }} />
            </div>
          {/if}
          {#if step.kind === 'action'}
            <Button variant="outline" size="sm" class="w-fit" onclick={() => onpickerchange(`${listKey}:replace:${step.id}`)}>Replace action</Button>
            {#if suggestedVariable}
              <Button variant="outline" size="sm" class="w-fit" onclick={() => bindVariable(suggestedVariableId!)}>
                Bind {suggestedVariable.definition.name} to state <PluginMark plugin={suggestedVariable.definition.owner} />
              </Button>
            {/if}
          {/if}
        {/if}
      </div>
    {/each}
  </div>

  {#if pickerKey === addKey}
    <div class="grid min-w-0 gap-3 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <Button variant={addingAction ? 'secondary' : 'outline'} size="default" onclick={() => addingAction = true}><Plus /> Action</Button>
        <Button variant="outline" size="default" onclick={addWait}>Wait</Button>
        <Button variant="outline" size="default" onclick={addCondition}>Condition</Button>
        <Button variant="ghost" size="default" class="ml-auto" aria-label="Close step picker" onclick={() => { adding = false; onpickerchange(null); }}>Close</Button>
      </div>
      {#if addingAction}<ActionPicker inline value="" onpick={addAction} />{/if}
    </div>
  {:else}
    <Button variant="outline" size="sm" class="w-fit" disabled={atLimit} onclick={() => { adding = true; addingAction = false; onpickerchange(addKey); }}>
      <Plus /> Add step
    </Button>
  {/if}
</div>

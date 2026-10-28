<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { actions } from '../../plugins/registry';
  import { MAX_SCENARIO_DEPTH, newId, type ActionStep, type Predicate } from '../scenario';
  import ActionPicker from './ActionPicker.svelte';

  let {
    current,
    depth,
    height,
    stateId,
    onchoose,
    onclose,
  }: {
    /** The step being changed; absent when adding a step. */
    current?: ActionStep;
    depth: number;
    height: number;
    /** The state a new Condition compares the button against. */
    stateId: string;
    onchoose: (step: ActionStep) => void;
    onclose: () => void;
  } = $props();

  function actionStep(id: string): ActionStep {
    const definition = actions.get(id);
    const args = Object.fromEntries(
      (definition?.params ?? [])
        .filter((param) => param.default !== undefined)
        .map((param) => [param.key, structuredClone(param.default)]),
    );
    return { id: newId(), kind: 'action', action: { id, args } };
  }

  function waitStep(): ActionStep {
    return { id: newId(), kind: 'delay', ms: 200 };
  }

  function conditionStep(): ActionStep {
    const condition: Predicate = {
      kind: 'compare',
      left: { kind: 'state', controlId: 'self' },
      op: 'eq',
      right: { kind: 'literal', value: stateId },
    };
    return { id: newId(), kind: 'if', condition, then: [], else: [] };
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
    }
  }
</script>

<div
  data-step-picker
  role="dialog"
  tabindex="-1"
  aria-label={current ? 'Change step' : 'Add step'}
  onkeydown={keydown}
  class="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain rounded-lg border bg-popover p-3 shadow-lg [scrollbar-gutter:stable]"
  style:height={`${height}px`}
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
      onclick={() => onchoose(waitStep())}>Wait</Button
    >
    <Button
      size="sm"
      variant={current?.kind === 'if' ? 'secondary' : 'ghost'}
      disabled={depth >= MAX_SCENARIO_DEPTH}
      onclick={() => onchoose(conditionStep())}>Condition</Button
    >
    <Button
      size="sm"
      variant="ghost"
      aria-label="Close step picker"
      onclick={onclose}>Close</Button
    >
  </div>
  <ActionPicker
    inline
    value={current?.kind === 'action' ? current.action.id : ''}
    onpick={(id) => onchoose(actionStep(id))}
  />
</div>

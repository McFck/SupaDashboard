<script lang="ts">
  import type { Snippet } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { actions } from '../../plugins/registry';
  import { runtimeView } from '../../../app/runtime/state';
  import type { ActionStep } from '../scenario';
  import type { VariableValue } from '../variables';
  import ConditionEditor from './ConditionEditor.svelte';
  import ParamField from '../../plugins/ui/ParamField.svelte';
  import PluginMark from '../../plugins/ui/PluginMark.svelte';

  let {
    step,
    index,
    count,
    locked,
    picker,
    effectPicker,
    branch,
    onmove,
    onshift,
    onremove,
    onupdate,
    onbind,
    onpick,
  }: {
    step: ActionStep;
    index: number;
    count: number;
    /** A step picker is open, so reordering waits. */
    locked: boolean;
    /** Shown instead of the body while this step's picker is open. */
    picker?: Snippet;
    effectPicker: Snippet;
    /** A Condition's Then or Else list. */
    branch: Snippet<['then' | 'else']>;
    onmove: (amount: number) => void;
    /** Alt+Arrow: move across the borders of Condition branches. */
    onshift: (direction: -1 | 1) => void;
    onremove: () => void;
    onupdate: (step: ActionStep) => void;
    onbind: (variableId: string, values?: readonly VariableValue[]) => void;
    onpick: (event: MouseEvent) => void;
  } = $props();

  const suggestedVariableId = $derived(bindingSuggestion(step));
  const suggestedVariable = $derived(
    suggestedVariableId ? $runtimeView.variables.records[suggestedVariableId] : undefined,
  );
  /** The body cross-fades when the picker opens or the step changes type or action. */
  const bodyKey = $derived.by(() => {
    if (picker) {
      return 'picker';
    }
    return step.kind === 'action' ? step.action.id : step.kind;
  });

  function bindingSuggestion(value: ActionStep) {
    if (value.kind !== 'action') {
      return undefined;
    }
    try {
      return actions.get(value.action.id)?.bindableVariable?.(value.action.args ?? {});
    } catch {
      return undefined;
    }
  }

  function bindSuggestedVariable() {
    if (suggestedVariableId && step.kind === 'action') {
      onbind(suggestedVariableId, actions.get(step.action.id)?.bindableValues);
    }
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

  function setArg(key: string, value: unknown) {
    if (step.kind === 'action') {
      onupdate({
        ...step,
        action: { ...step.action, args: { ...step.action.args, [key]: value } },
      });
    }
  }

  function setDelay(raw: string) {
    const ms = raw === '' ? 0 : Number(raw);
    if (step.kind === 'delay' && Number.isInteger(ms)) {
      onupdate({ ...step, ms });
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!direction) {
      return;
    }
    event.preventDefault();
    if (event.altKey) {
      onshift(direction);
    } else {
      onmove(direction);
    }
  }
</script>

<div class="flex min-w-0 items-center gap-2">
  <button
    data-step-handle
    type="button"
    aria-label="Reorder step"
    disabled={locked}
    class="grid size-8 shrink-0 touch-none place-items-center rounded text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40"
    onkeydown={handleKeydown}><GripVertical class="size-4" /></button
  >
  <span class="min-w-0 flex-1 truncate text-sm font-medium">
    {#if step.kind === 'action'}{actions.get(step.action.id)?.title ?? step.action.id}
    {:else if step.kind === 'delay'}Wait
    {:else}Condition{/if}
  </span>
  {#if step.kind === 'action' && !actions.has(step.action.id)}<span
      class="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">Unavailable</span
    >{/if}
  {@render effectPicker()}
  <Button
    size="icon-sm"
    variant="ghost"
    aria-label="Move step up"
    disabled={index === 0}
    onclick={() => onmove(-1)}><ArrowUp /></Button
  >
  <Button
    size="icon-sm"
    variant="ghost"
    aria-label="Move step down"
    disabled={index === count - 1}
    onclick={() => onmove(1)}><ArrowDown /></Button
  >
  <Button
    size="icon-sm"
    variant="ghost"
    aria-label="Remove step"
    onclick={onremove}><Trash /></Button
  >
</div>

<div class="relative min-w-0">
  {#key bodyKey}
    <div
      class="grid min-w-0 gap-3"
      in:bodyFade
      out:bodyFade={{ out: true }}
    >
      {#if picker}
        {@render picker()}
      {:else}
        {#if step.kind === 'action'}
          {#if actions.has(step.action.id)}
            <div class="grid gap-3">
              {#each actions.get(step.action.id)?.params ?? [] as param (param.key)}
                {#if !param.visible || param.visible(step.action.args ?? {})}
                  <ParamField
                    {param}
                    provider={actions.get(step.action.id)?.plugin}
                    args={step.action.args ?? {}}
                    value={step.action.args?.[param.key]}
                    onchange={(value) => setArg(param.key, value)}
                  />
                {/if}
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
              oninput={(event) => setDelay(event.currentTarget.value)}
            />
          </div>
        {:else}
          <ConditionEditor
            condition={step.condition}
            onchange={(condition) => onupdate({ ...step, condition })}
          />
          <div class="grid gap-2 pl-3">
            <h4 class="section-label">Then</h4>
            {@render branch('then')}
          </div>
          <div class="grid gap-2 pl-3">
            <h4 class="section-label">Else</h4>
            {@render branch('else')}
          </div>
        {/if}
        <Button
          data-step-change
          variant="outline"
          size="sm"
          class="w-fit"
          onclick={onpick}>{step.kind === 'action' ? 'Replace action' : 'Change step'}</Button
        >
        {#if suggestedVariableId && suggestedVariable}
          <Button
            variant="outline"
            size="sm"
            class="w-fit"
            onclick={bindSuggestedVariable}
          >
            Bind {suggestedVariable.definition.name} to state <PluginMark
              plugin={suggestedVariable.definition.owner}
            />
          </Button>
        {/if}
      {/if}
    </div>
  {/key}
</div>

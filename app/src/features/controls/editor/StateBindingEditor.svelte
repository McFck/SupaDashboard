<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import type { Variant } from '../model';
  import { stateIdAt } from '../variants';
  import type { Scalar, StateBinding } from '../../automation/scenario';
  import { runtimeView } from '../../../app/runtime/state';
  import { parseVariableText, type VariableType } from '../../automation/variables';
  import Choice from '../../plugins/ui/Choice.svelte';

  let {
    binding,
    variants,
    roles,
    onchange,
  }: {
    binding?: StateBinding;
    variants: Variant[];
    roles?: { off: string; on: string };
    onchange: (value: StateBinding | undefined) => void;
  } = $props();
  const variables = $derived(Object.values($runtimeView.variables.records));
  const options = $derived([
    { value: '', label: 'None' },
    ...variables.map((record) => ({
      value: record.definition.id,
      label: record.definition.name,
      detail: record.definition.type,
      unavailable: record.definition.available === false,
      plugin: record.definition.owner,
    })),
  ]);
  const variable = $derived(
    variables.find((record) => record.definition.id === binding?.variableId),
  );
  const states = $derived(
    variants.map((variant, index) => ({
      value: stateIdAt({ variants }, index),
      label: variant.label || `State ${index + 1}`,
    })),
  );
  const caseType = $derived<VariableType | undefined>(variable?.definition.type);

  function setVariable(id: string) {
    if (!id) {
      onchange(undefined);
      return;
    }
    if (binding?.variableId === id) return;
    const record = variables.find((item) => item.definition.id === id);
    let cases: StateBinding['cases'] = [];
    if (record?.definition.type === 'boolean' && roles)
      cases = [
        { value: false, stateId: roles.off },
        { value: true, stateId: roles.on },
      ];
    onchange({ variableId: id, cases });
  }
  function updateCase(index: number, patch: Partial<StateBinding['cases'][number]>) {
    if (!binding) return;
    onchange({
      ...binding,
      cases: binding.cases.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }
  function addCase() {
    if (!binding) return;
    const type = caseType;
    const values: Scalar[] =
      type === 'boolean'
        ? [false, true]
        : type === 'integer' || type === 'float'
          ? [0, 1, -1]
          : [''];
    let value = values.find(
      (candidate) =>
        !binding.cases.some(
          (item) => typeof item.value === typeof candidate && item.value === candidate,
        ),
    );
    if (value === undefined) {
      if (type === 'string') {
        let suffix = 1;
        while (binding.cases.some((item) => item.value === `Value ${suffix}`)) suffix++;
        value = `Value ${suffix}`;
      } else return;
    }
    const stateId = states[0]?.value;
    if (stateId) onchange({ ...binding, cases: [...binding.cases, { value, stateId }] });
  }
  function setValue(index: number, raw: string) {
    if (!binding) return;
    const type =
      caseType ??
      (typeof binding.cases[index]?.value === 'boolean'
        ? 'boolean'
        : typeof binding.cases[index]?.value === 'number'
          ? 'float'
          : 'string');
    try {
      updateCase(index, { value: parseVariableText(type, raw) });
    } catch {
      // Keep incomplete numeric input local until it is a valid scalar.
    }
  }
  function stateOptions(stateId: string) {
    return [
      ...states,
      ...(stateId && !states.some((state) => state.value === stateId)
        ? [{ value: stateId, label: stateId, unavailable: true }]
        : []),
    ];
  }
</script>

<div class="grid min-h-0 gap-4 overflow-y-auto p-4 [scrollbar-gutter:stable]">
  <div class="grid gap-2 rounded-xl bg-card p-3">
    <Label>Variable</Label>
    <Choice
      value={binding?.variableId ?? ''}
      {options}
      placeholder="None"
      aria-label="State variable"
      onchange={setVariable}
    />
    {#if binding && !variable}<span class="flex min-w-0 items-center gap-2 text-xs"
        ><span class="truncate">{binding.variableId}</span><Badge variant="outline"
          >Unavailable</Badge
        ></span
      >{/if}
  </div>
  {#if binding}
    <div class="grid gap-3 rounded-xl bg-card p-3">
      <div class="flex items-center gap-2">
        <h3 class="min-w-0 flex-1 text-sm font-semibold">Value mappings</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={!states.length || (caseType === 'boolean' && binding.cases.length >= 2)}
          onclick={addCase}><Plus /> Add mapping</Button
        >
      </div>
      {#each binding.cases as item, index (index)}
        <div
          class="grid min-w-0 gap-2 rounded-lg bg-white/[.03] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        >
          <div class="grid min-w-0 gap-1.5">
            <Label>Value</Label>
            {#if caseType === 'boolean' || (!caseType && typeof item.value === 'boolean')}
              <Choice
                value={String(item.value)}
                options={[
                  { value: 'false', label: 'False' },
                  { value: 'true', label: 'True' },
                ]}
                aria-label="Mapped value"
                onchange={(value) => updateCase(index, { value: value === 'true' })}
              />
            {:else}
              <Input
                aria-label="Mapped value"
                type={caseType === 'string' || (!caseType && typeof item.value === 'string')
                  ? 'text'
                  : 'number'}
                step={caseType === 'integer' ? '1' : 'any'}
                value={String(item.value)}
                oninput={(event) => setValue(index, event.currentTarget.value)}
              />
            {/if}
          </div>
          <div class="grid min-w-0 gap-1.5">
            <Label>State</Label>
            <Choice
              value={item.stateId}
              options={stateOptions(item.stateId)}
              aria-label="Mapped state"
              onchange={(stateId) => updateCase(index, { stateId })}
            />
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove mapping"
            onclick={() =>
              onchange({ ...binding, cases: binding.cases.filter((_, i) => i !== index) })}
            ><Trash /></Button
          >
        </div>
      {/each}
    </div>
  {/if}
</div>

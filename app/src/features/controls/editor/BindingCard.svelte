<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import type { Variant } from '../model';
  import { stateChoices } from '../variants';
  import type { Scalar, StateBinding } from '../../automation/scenario';
  import { runtimeView } from '../../../app/runtime/state';
  import { settings } from '../../settings/state.svelte';
  import { parseVariableText, type VariableType } from '../../automation/variables';
  import Choice from '../../plugins/ui/Choice.svelte';
  import SuggestionInput from '../../plugins/ui/SuggestionInput.svelte';
  import MonitorField from '../../apps/ui/MonitorField.svelte';
  import AppStateField from '../../apps/ui/AppStateField.svelte';
  import { APP_STATES, appFieldOf, parseAppVariable, pendingAppVariable } from '../../apps/keys';

  let {
    binding,
    variants,
    roles,
    sole,
    first,
    last,
    onchange,
    onmove,
    onremove,
  }: {
    binding: StateBinding;
    variants: Variant[];
    roles?: { off: string; on: string };
    /** The only binding of the control: a Boolean variable then starts mapped to the Off and On states. */
    sole: boolean;
    first: boolean;
    last: boolean;
    onchange: (value: StateBinding) => void;
    onmove: (direction: -1 | 1) => void;
    onremove: () => void;
  } = $props();
  const variables = $derived(Object.values($runtimeView.variables.records));
  const appField = $derived(appFieldOf(binding.variableId));
  /** App variables are one group per state; the app itself is picked next. */
  const options = $derived([
    ...APP_STATES.map((state) => ({
      value: pendingAppVariable(state.value),
      label: `App › ${state.label}`,
      detail: state.value === 'display' ? 'string' : 'boolean',
    })),
    ...variables
      .filter((record) => !parseAppVariable(record.definition.id))
      .map((record) => ({
        value: record.definition.id,
        label: record.definition.name,
        detail: record.definition.type,
        unavailable: record.definition.available === false,
        plugin: record.definition.owner,
      })),
  ]);
  const variable = $derived(
    variables.find((record) => record.definition.id === binding.variableId),
  );
  const states = $derived(stateChoices(variants));
  const caseType = $derived<VariableType | undefined>(
    appField ? (appField === 'display' ? 'string' : 'boolean') : variable?.definition.type,
  );
  const booleanLabels = $derived(
    appField
      ? [
          { value: 'false', label: 'Off' },
          { value: 'true', label: 'On' },
        ]
      : [
          { value: 'false', label: 'False' },
          { value: 'true', label: 'True' },
        ],
  );
  const pageOptions = $derived(
    binding.variableId === 'page.active'
      ? settings.deck.pages.map((page) => ({ value: page.id, label: page.name }))
      : undefined,
  );
  const valueOptions = $derived(
    pageOptions ? pageOptions.map((option) => option.value) : variable?.definition.options,
  );

  function setVariable(id: string) {
    if (id === (appField ? pendingAppVariable(appField) : binding.variableId)) return;
    const pending = appFieldOf(id);
    const record = variables.find((item) => item.definition.id === id);
    const boolean = pending ? pending !== 'display' : record?.definition.type === 'boolean';
    onchange({
      variableId: id,
      cases:
        boolean && roles && sole
          ? [
              { value: false, stateId: roles.off },
              { value: true, stateId: roles.on },
            ]
          : [],
    });
  }
  function updateCase(index: number, patch: Partial<StateBinding['cases'][number]>) {
    onchange({
      ...binding,
      cases: binding.cases.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }
  function addCase() {
    const type = caseType;
    const values: Scalar[] =
      valueOptions ??
      (type === 'boolean'
        ? [false, true]
        : type === 'integer' || type === 'float'
          ? [0, 1, -1]
          : ['']);
    let value = values.find(
      (candidate) =>
        !binding.cases.some(
          (item) => typeof item.value === typeof candidate && item.value === candidate,
        ),
    );
    if (value === undefined) {
      if (valueOptions) return;
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

<div class="grid gap-3 rounded-xl bg-card p-3">
  <div class="flex items-center gap-1">
    <h3 class="min-w-0 flex-1 text-sm font-semibold">Variable</h3>
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Move binding up"
      disabled={first}
      onclick={() => onmove(-1)}><ArrowUp /></Button
    >
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Move binding down"
      disabled={last}
      onclick={() => onmove(1)}><ArrowDown /></Button
    >
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Remove binding"
      onclick={onremove}><Trash /></Button
    >
  </div>
  <SuggestionInput
    strict
    value={appField ? pendingAppVariable(appField) : binding.variableId}
    suggestions={options}
    placeholder="Variable"
    aria-label="State variable"
    onchange={setVariable}
  />
  {#if appField}
    <AppStateField
      value={binding.variableId}
      fixedField={appField}
      onchange={(id) => onchange({ ...binding, variableId: id })}
    />
  {:else if binding.variableId && !variable}
    <span class="flex min-w-0 items-center gap-2 text-xs"
      ><span class="truncate">{binding.variableId}</span><Badge variant="outline">Unavailable</Badge
      ></span
    >
  {/if}
  {#if binding.variableId && (!appField || parseAppVariable(binding.variableId))}
    <div class="flex items-center gap-2">
      <h3 class="min-w-0 flex-1 text-sm font-semibold">Value mappings</h3>
      <Button
        size="sm"
        variant="outline"
        disabled={!states.length ||
          (caseType === 'boolean' && binding.cases.length >= 2) ||
          !!valueOptions?.every((value) => binding.cases.some((item) => item.value === value))}
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
              options={booleanLabels}
              aria-label="Mapped value"
              onchange={(value) => updateCase(index, { value: value === 'true' })}
            />
          {:else if pageOptions}
            <Choice
              value={String(item.value)}
              options={[
                ...pageOptions,
                ...(item.value && !pageOptions.some((option) => option.value === item.value)
                  ? [{ value: String(item.value), label: String(item.value), unavailable: true }]
                  : []),
              ]}
              aria-label="Mapped value"
              onchange={(value) => updateCase(index, { value })}
            />
          {:else if valueOptions}
            <Choice
              value={String(item.value)}
              options={valueOptions.map((value) => ({ value, label: value }))}
              aria-label="Mapped value"
              onchange={(value) => updateCase(index, { value })}
            />
          {:else if appField === 'display'}
            <MonitorField
              value={String(item.value)}
              onchange={(name) => updateCase(index, { value: name })}
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
  {/if}
</div>

<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { runtimeView } from '../../../app/runtime/state';
  import { settings } from '../../settings/state.svelte';
  import type { Operand, Predicate, Scalar } from '../scenario';
  import Choice from '../../plugins/ui/Choice.svelte';
  import SuggestionInput from '../../plugins/ui/SuggestionInput.svelte';
  import AppStateField from '../../apps/ui/AppStateField.svelte';
  import { parseAppVariable } from '../../apps/keys';
  import { alignRight, comparators, firstPlainVariable, operandKind } from '../operand-kinds';

  let { condition, onchange }: { condition: Predicate; onchange: (value: Predicate) => void } =
    $props();
  const variables = $derived(
    Object.values($runtimeView.variables.records)
      .filter((record) => !parseAppVariable(record.definition.id))
      .map((record) => ({
        value: record.definition.id,
        label: record.definition.name,
        detail: record.definition.type,
        plugin: record.definition.owner,
      })),
  );
  const typeOf = (id: string) => $runtimeView.variables.records[id]?.definition.type;
  const stateOptions = $derived([
    { value: 'self', label: 'This control' },
    ...settings.controls.map((control) => ({
      value: control.id,
      label: control.name,
    })),
  ]);
  const variableOptions = (id: string) => [
    ...variables,
    ...(id && !variables.some((option) => option.value === id)
      ? [{ value: id, label: id, unavailable: true }]
      : []),
  ];
  const controlStateOptions = (id: string) => [
    ...stateOptions,
    ...(id !== 'self' && !stateOptions.some((option) => option.value === id)
      ? [{ value: id, label: id, unavailable: true }]
      : []),
  ];

  /** Sides whose App operand has no app yet; once chosen it is an ordinary variable operand. */
  let pendingApp = $state<string[]>([]);
  const kindOf = (side: string, operand: Operand) =>
    operandKind(operand, pendingApp.includes(side));

  /** Whether the left operand is an app: the condition then reads "App is Running" with nothing to compare to. */
  const appCondition = $derived(
    condition.kind === 'compare' && kindOf('left', condition.left) === 'app',
  );
  const OPERATOR_LABELS = {
    eq: 'Equals',
    ne: 'Does not equal',
    gt: 'Greater than',
    lt: 'Less than',
  };
  const operators = $derived(
    (condition.kind === 'compare'
      ? comparators(condition.left, condition.right, typeOf)
      : ['eq', 'ne']
    ).map((value) => ({ value, label: OPERATOR_LABELS[value as keyof typeof OPERATOR_LABELS] })),
  );

  function setKind(kind: 'compare' | 'expression') {
    onchange(
      kind === 'expression'
        ? { kind, source: '' }
        : {
            kind,
            left: { kind: 'literal', value: '' },
            op: 'eq',
            right: { kind: 'literal', value: '' },
          },
    );
  }
  function setOperand(side: 'left' | 'right', value: Operand) {
    if (condition.kind !== 'compare') return;
    const next = { ...condition, [side]: value };
    onchange({ ...next, right: alignRight(next.left, next.right, typeOf) });
  }
  function changeOperandKind(side: 'left' | 'right', kind: string) {
    pendingApp =
      kind === 'app' ? [...pendingApp, side] : pendingApp.filter((item) => item !== side);
    const value: Operand =
      kind === 'app'
        ? { kind: 'variable', id: '' }
        : kind === 'variable'
          ? { kind, id: firstPlainVariable(variables.map((option) => option.value)) }
          : kind === 'state'
            ? { kind, controlId: 'self' }
            : { kind: 'literal', value: '' };
    if (side === 'left' && condition.kind === 'compare') {
      // An app condition is `app.<name>.<state>` equals true; "is not" flips the operator.
      onchange({
        ...condition,
        left: value,
        op: 'eq',
        right: alignRight(value, { kind: 'literal', value: kind === 'app' ? true : '' }, typeOf),
      });
      return;
    }
    setOperand(side, value);
  }
  /** The state decides what the condition compares to: on/off for flags, a monitor name for the display. */
  function setAppVariable(id: string) {
    if (condition.kind !== 'compare') return;
    const compared = condition.right.kind === 'literal' ? condition.right.value : undefined;
    const wanted = parseAppVariable(id)?.field === 'display' ? 'string' : 'boolean';
    onchange({
      ...condition,
      left: { kind: 'variable', id },
      right:
        typeof compared === wanted
          ? condition.right
          : { kind: 'literal', value: wanted === 'string' ? '' : true },
    });
  }
  function setLiteral(side: 'left' | 'right', value: Scalar) {
    setOperand(side, { kind: 'literal', value });
  }
  function setLiteralType(side: 'left' | 'right', type: string) {
    setLiteral(side, type === 'boolean' ? false : type === 'number' ? 0 : '');
  }
</script>

<div class="grid gap-3 rounded-lg bg-background/40 p-3">
  <div class="grid gap-1.5">
    <Label class="text-xs text-muted-foreground">Condition</Label>
    <Choice
      value={condition.kind}
      options={[
        { value: 'compare', label: 'Compare values' },
        { value: 'expression', label: 'Expression' },
      ]}
      onchange={(v) => setKind(v as 'compare' | 'expression')}
    />
  </div>
  {#if condition.kind === 'expression'}
    <div class="grid gap-1.5">
      <Label class="text-xs text-muted-foreground">Expression</Label>
      <Input
        value={condition.source}
        oninput={(e) => onchange({ ...condition, source: e.currentTarget.value })}
      />
    </div>
  {:else}
    <div class="@container">
      <div
        class={[
          'grid items-start gap-3',
          !appCondition && '@xl:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]',
        ]}
      >
        {#each appCondition ? ['left'] : ['left', 'right'] as side (side)}
          {@const operand = condition[side as 'left' | 'right']}
          <div class="grid min-w-0 content-start gap-1.5">
            <Label class="text-xs text-muted-foreground"
              >{side === 'left' ? 'Value' : 'Compare to'}</Label
            >
            <Choice
              value={kindOf(side, operand)}
              options={[
                { value: 'literal', label: 'Value' },
                { value: 'variable', label: 'Variable' },
                { value: 'app', label: 'App' },
                { value: 'state', label: 'Control state' },
              ]}
              onchange={(value) => changeOperandKind(side as 'left' | 'right', value)}
            />
            {#if operand.kind === 'variable' && kindOf(side, operand) === 'app'}
              <AppStateField
                value={operand.id}
                negation={side === 'left' && appCondition
                  ? {
                      negated: condition.op === 'ne',
                      onchange: (negated) => onchange({ ...condition, op: negated ? 'ne' : 'eq' }),
                    }
                  : undefined}
                monitor={side === 'left' && appCondition && condition.right.kind === 'literal'
                  ? {
                      value: typeof condition.right.value === 'string' ? condition.right.value : '',
                      onchange: (name) =>
                        onchange({ ...condition, right: { kind: 'literal', value: name } }),
                    }
                  : undefined}
                onchange={(id) =>
                  side === 'left' && appCondition
                    ? setAppVariable(id)
                    : setOperand(side as 'left' | 'right', { ...operand, id })}
              />
            {:else if operand.kind === 'variable'}
              <SuggestionInput
                strict
                value={operand.id}
                suggestions={variableOptions(operand.id)}
                placeholder="Variable"
                aria-label="Variable"
                onchange={(value) =>
                  setOperand(side as 'left' | 'right', { ...operand, id: value })}
              />
            {:else if operand.kind === 'state'}
              <Choice
                value={operand.controlId}
                options={controlStateOptions(operand.controlId)}
                onchange={(value) =>
                  setOperand(side as 'left' | 'right', { ...operand, controlId: value })}
              />
            {:else}
              <Choice
                value={typeof operand.value}
                options={[
                  { value: 'boolean', label: 'Boolean' },
                  { value: 'number', label: 'Number' },
                  { value: 'string', label: 'Text' },
                ]}
                aria-label="Value type"
                onchange={(value) => setLiteralType(side as 'left' | 'right', value)}
              />
              {#if typeof operand.value === 'boolean'}
                <Choice
                  value={String(operand.value)}
                  options={[
                    { value: 'false', label: 'False' },
                    { value: 'true', label: 'True' },
                  ]}
                  onchange={(value) => setLiteral(side as 'left' | 'right', value === 'true')}
                />
              {:else}
                <Input
                  aria-label={side === 'left' ? 'Value' : 'Compare to'}
                  type={typeof operand.value === 'number' ? 'number' : 'text'}
                  value={String(operand.value ?? '')}
                  oninput={(e) => {
                    const value = e.currentTarget.value;
                    setLiteral(
                      side as 'left' | 'right',
                      typeof operand.value === 'number' ? Number(value) : value,
                    );
                  }}
                />
              {/if}
            {/if}
          </div>
          {#if side === 'left' && !appCondition}
            <div class="grid min-w-0 content-start gap-1.5">
              <Label class="text-xs text-muted-foreground">Operator</Label>
              <Choice
                value={condition.op}
                class="w-full min-w-0"
                options={operators}
                onchange={(value) =>
                  onchange({ ...condition, op: value as 'eq' | 'ne' | 'gt' | 'lt' })}
              />
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</div>

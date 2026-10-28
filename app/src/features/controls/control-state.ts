// The state a control shows: its variable binding when one matches, otherwise the manually chosen state.
import type { ControlConfig, TileAppearance } from './model';
import { stateIdAt, variantIndexForState } from './variants';
import { renderTemplate } from '../automation/templates';
import { VariableStore, type VariableSnapshot, type VariableValue } from '../automation/variables';

export type RuntimeVariables = VariableSnapshot | VariableStore;
export type EffectiveVariant = { index: number; stateId: string; view: TileAppearance };

function getValue(variables: RuntimeVariables | undefined, id: string): VariableValue | undefined {
  if (!variables) return undefined;
  if (variables instanceof VariableStore) return variables.getValue(id);
  return variables.records[id]?.value;
}

function getName(variables: RuntimeVariables | undefined, name: string): VariableValue | undefined {
  if (!variables) return undefined;
  if (variables instanceof VariableStore) return variables.findByName(name)?.value;
  const key = name.trim().toLocaleLowerCase();
  const record = Object.values(variables.records).find((item) =>
    [item.definition.name, ...(item.definition.aliases ?? [])].some(
      (value) => value.trim().toLocaleLowerCase() === key,
    ),
  );
  return record?.value;
}

function caseState(control: ControlConfig, value: VariableValue | undefined): string | undefined {
  const binding = control.stateBinding;
  if (value === undefined || !binding) return undefined;
  const match = binding.cases.find(
    (item) => typeof item.value === typeof value && item.value === value,
  );
  if (match) return match.stateId;
  if (!binding.cases.length && typeof value === 'boolean' && control.stateRoles)
    return value ? control.stateRoles.on : control.stateRoles.off;
  return undefined;
}

/** Resolve a bound presentation without mutating settings or the manual fallback. */
export function effectiveVariant(
  control: ControlConfig,
  runtimeVariables: RuntimeVariables | undefined,
  manualIndex: number,
): EffectiveVariant {
  const count = control.variants.length;
  const fallback = count
    ? Math.min(Math.max(Number.isInteger(manualIndex) ? manualIndex : 0, 0), count - 1)
    : 0;
  const boundValue = control.stateBinding
    ? getValue(runtimeVariables, control.stateBinding.variableId)
    : undefined;
  const boundState = caseState(control, boundValue);
  const index = boundState ? (variantIndexForState(control, boundState) ?? fallback) : fallback;
  const variant = control.variants[index];
  const template = renderTemplate(variant?.label ?? '', (name) => getName(runtimeVariables, name));
  return {
    index,
    stateId: variant ? stateIdAt(control, index) : '',
    view: {
      label: template.text,
      icon: variant?.icon,
      color: variant?.color,
      background: variant?.background,
    },
  };
}

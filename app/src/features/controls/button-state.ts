import type { ControlConfig, TileAppearance } from './model';
import { renderTemplate } from '../automation/templates';
import { VariableStore, type VariableSnapshot, type VariableValue } from '../automation/variables';

export type RuntimeVariables =
  VariableSnapshot | VariableStore | Readonly<Record<string, VariableValue>>;
export type EffectiveVariant = { index: number; stateId: string; view: TileAppearance };

export function validateStateConfiguration(
  control: Pick<ControlConfig, 'variants' | 'stateBinding' | 'stateRoles'>,
  variables?: VariableSnapshot,
) {
  const issues: { path: string; message: string }[] = [];
  const states = new Set(
    control.variants.map((_, index) => stateIdAt(control as ControlConfig, index)),
  );
  if (control.stateRoles) {
    if (
      !states.has(control.stateRoles.off) ||
      !states.has(control.stateRoles.on) ||
      control.stateRoles.off === control.stateRoles.on
    )
      issues.push({
        path: 'stateRoles',
        message: 'Off and On states must be different available states',
      });
  }
  const binding = control.stateBinding;
  if (!binding) return issues;
  const variable = variables?.records[binding.variableId];
  if (!binding.variableId || !variable || variable.definition.available === false)
    issues.push({ path: 'stateBinding.variableId', message: 'Bound variable is unavailable' });
  const seen = new Set<string>();
  for (const item of binding.cases) {
    const key = `${typeof item.value}:${String(item.value)}`;
    if (seen.has(key))
      issues.push({ path: 'stateBinding.cases', message: 'State values must be unique' });
    seen.add(key);
    if (!states.has(item.stateId))
      issues.push({ path: 'stateBinding.cases', message: 'Bound state is unavailable' });
    if (!variable) continue;
    const validType =
      variable.definition.type === 'boolean'
        ? typeof item.value === 'boolean'
        : variable.definition.type === 'integer'
          ? typeof item.value === 'number' && Number.isSafeInteger(item.value)
          : variable.definition.type === 'float'
            ? typeof item.value === 'number' && Number.isFinite(item.value)
            : typeof item.value === 'string';
    if (!validType)
      issues.push({
        path: 'stateBinding.cases',
        message: 'State value does not match the variable type',
      });
  }
  return issues;
}

export function stateIdAt(control: ControlConfig, index: number) {
  return control.variants[index]?.id ?? `state-${index + 1}`;
}

export function variantIndexForState(control: ControlConfig, stateId: string) {
  const index = control.variants.findIndex((variant, i) => stateIdAt(control, i) === stateId);
  return index < 0 ? undefined : index;
}

function getValue(variables: RuntimeVariables | undefined, id: string): VariableValue | undefined {
  if (!variables) return undefined;
  if (variables instanceof VariableStore) return variables.getValue(id);
  if ('revision' in variables && 'records' in variables)
    return (variables as VariableSnapshot).records[id]?.value;
  return (variables as Readonly<Record<string, VariableValue>>)[id];
}

function getName(variables: RuntimeVariables | undefined, name: string): VariableValue | undefined {
  if (!variables) return undefined;
  if (variables instanceof VariableStore) return variables.findByName(name)?.value;
  if ('revision' in variables && 'records' in variables) {
    const key = name.trim().toLocaleLowerCase();
    const record = Object.values((variables as VariableSnapshot).records).find((item) =>
      [item.definition.name, ...(item.definition.aliases ?? [])].some(
        (value) => value.trim().toLocaleLowerCase() === key,
      ),
    );
    return record?.value;
  }
  return undefined;
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

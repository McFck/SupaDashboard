// Editor checks for a control's state roles and variable binding.
import type { ControlConfig } from './model';
import { stateIdAt } from './variants';
import type { StateBinding } from '../automation/scenario';
import type { VariableSnapshot } from '../automation/variables';
import { parseAppVariable, validAppVariable } from '../apps/keys';

export function validateStateConfiguration(
  control: Pick<ControlConfig, 'variants' | 'stateBindings' | 'stateRoles'>,
  variables?: VariableSnapshot,
) {
  const issues: { path: string; message: string }[] = [];
  const states = new Set(control.variants.map((_, index) => stateIdAt(control, index)));
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
  control.stateBindings?.forEach((binding, index) => {
    issues.push(...validateBinding(binding, `stateBindings.${index}`, states, variables));
  });
  return issues;
}

function validateBinding(
  binding: StateBinding,
  path: string,
  states: Set<string>,
  variables?: VariableSnapshot,
) {
  const issues: { path: string; message: string }[] = [];
  const variable = variables?.records[binding.variableId];
  // A draft's scoped variable starts being watched only after Save.
  const scoped = parseAppVariable(binding.variableId)?.selection;
  if (
    !validAppVariable(binding.variableId) ||
    !binding.variableId ||
    (!variable && !scoped) ||
    variable?.definition.available === false
  )
    issues.push({ path: `${path}.variableId`, message: 'Bound variable is unavailable' });
  const seen = new Set<string>();
  for (const item of binding.cases) {
    const key = `${typeof item.value}:${String(item.value)}`;
    if (seen.has(key))
      issues.push({ path: `${path}.cases`, message: 'State values must be unique' });
    seen.add(key);
    if (!states.has(item.stateId))
      issues.push({ path: `${path}.cases`, message: 'Bound state is unavailable' });
    if (!variable && !scoped) {
      continue;
    }
    const type = variable?.definition.type ?? 'boolean';
    const validType =
      type === 'boolean'
        ? typeof item.value === 'boolean'
        : type === 'integer'
          ? typeof item.value === 'number' && Number.isSafeInteger(item.value)
          : type === 'float'
            ? typeof item.value === 'number' && Number.isFinite(item.value)
            : typeof item.value === 'string';
    if (!validType)
      issues.push({
        path: `${path}.cases`,
        message: 'State value does not match the variable type',
      });
  }
  return issues;
}

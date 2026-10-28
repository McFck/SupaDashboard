// Editor checks for a control's state roles and variable binding.
import type { ControlConfig } from './model';
import { stateIdAt } from './variants';
import type { VariableSnapshot } from '../automation/variables';

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

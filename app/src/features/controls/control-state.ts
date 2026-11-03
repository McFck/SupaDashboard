// The state a control shows: its variable binding when one matches, otherwise the manually chosen state.
import type { ControlConfig, TileAppearance, Variant } from './model';
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

/** The first binding, top to bottom, whose mapping matches its variable's value decides the state. */
function boundState(
  control: ControlConfig,
  variables: RuntimeVariables | undefined,
): string | undefined {
  const bindings = control.stateBindings ?? [];
  for (const binding of bindings) {
    const value = getValue(variables, binding.variableId);
    if (value === undefined) continue;
    const match = binding.cases.find(
      (item) => typeof item.value === typeof value && item.value === value,
    );
    if (match) return match.stateId;
    // A lone Boolean binding without mappings follows the Off/On roles.
    if (
      bindings.length === 1 &&
      !binding.cases.length &&
      typeof value === 'boolean' &&
      control.stateRoles
    )
      return value ? control.stateRoles.on : control.stateRoles.off;
  }
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
  const bound = boundState(control, runtimeVariables);
  const index = bound ? (variantIndexForState(control, bound) ?? fallback) : fallback;
  const variant = control.variants[index];
  return {
    index,
    stateId: variant ? stateIdAt(control, index) : '',
    view: variantView(variant, runtimeVariables),
  };
}

/** A state's appearance with its label template filled from the variables. */
export function variantView(
  variant: Variant | undefined,
  runtimeVariables: RuntimeVariables | undefined,
): TileAppearance {
  const template = renderTemplate(variant?.label ?? '', (name) => getName(runtimeVariables, name));
  return {
    label: template.text,
    icon: variant?.icon,
    color: variant?.color,
    background: variant?.background,
    style: variant?.style,
  };
}

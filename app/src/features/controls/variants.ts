// State identity and pure edits of a control's states. Scenarios, bindings and roles refer to states by these ids.
import type { ActionStep } from '../automation/scenario';
import type { ControlConfig } from './model';

export function stateIdAt(control: ControlConfig, index: number) {
  return control.variants[index]?.id ?? `state-${index + 1}`;
}

export function variantIndexForState(control: ControlConfig, stateId: string) {
  const index = control.variants.findIndex((variant, i) => stateIdAt(control, i) === stateId);
  return index < 0 ? undefined : index;
}

/** Move a state; scenario references use stable IDs. Returns the reordered current index. */
export function moveVariant(
  control: ControlConfig,
  current: number,
  from: number,
  to: number,
): number {
  const n = control.variants.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return current;
  const [moved] = control.variants.splice(from, 1);
  control.variants.splice(to, 0, moved);
  const remap = (i: number) =>
    i === from
      ? to
      : from < to && i > from && i <= to
        ? i - 1
        : from > to && i >= to && i < from
          ? i + 1
          : i;
  return remap(current);
}

/** Remove a state and repair only references scoped to that control. */
export function removeVariant(control: ControlConfig, current: number, index: number): number {
  const n = control.variants.length;
  if (n < 2 || index < 0 || index >= n) return current;
  const removedId = control.variants[index].id ?? `state-${index + 1}`;
  const replacement = control.variants[Math.min(index, n - 2)];
  const replacementId = replacement.id ?? `state-${Math.min(index, n - 2) + 1}`;
  control.variants.splice(index, 1);
  const remap = (i: number) => (i === index ? Math.min(index, n - 2) : i > index ? i - 1 : i);

  const visit = (steps: ActionStep[] = []) => {
    for (const step of steps) {
      if (
        step.kind === 'action' &&
        step.action.id === 'button.variant' &&
        step.action.args?.target === 'self' &&
        step.action.args.variant === removedId
      )
        step.action.args.variant = replacementId;
      else if (step.kind === 'if') {
        visit(step.then);
        visit(step.else);
      }
    }
  };
  for (const list of Object.values(control.scenario?.triggers ?? {})) {
    if (!list) continue;
    delete list.byState?.[removedId];
    visit(list.steps);
    for (const steps of Object.values(list.byState ?? {})) visit(steps);
  }
  for (const event of control.scenario?.events ?? []) {
    delete event.list.byState?.[removedId];
    visit(event.list.steps);
    for (const steps of Object.values(event.list.byState ?? {})) visit(steps);
  }
  if (control.stateBinding)
    control.stateBinding.cases = control.stateBinding.cases.filter(
      (item) => item.stateId !== removedId,
    );
  if (
    control.stateRoles &&
    (control.stateRoles.off === removedId || control.stateRoles.on === removedId)
  )
    delete control.stateRoles;
  return remap(current);
}

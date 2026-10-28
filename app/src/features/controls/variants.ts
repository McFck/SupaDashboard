// State identity and pure edits of a control's states. Scenarios, bindings and roles refer to states by these ids.
import type { ActionStep } from '../automation/scenario';
import type { ControlConfig } from './model';

/** The one id rule: a state without a stored id is named by its position. */
export function stateIdAt(control: Pick<ControlConfig, 'variants'>, index: number) {
  return control.variants[index]?.id ?? `state-${index + 1}`;
}

export function variantIndexForState(control: Pick<ControlConfig, 'variants'>, stateId: string) {
  const index = control.variants.findIndex((_, i) => stateIdAt(control, i) === stateId);
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
  if (current === from) {
    return to;
  }
  if (from < to && current > from && current <= to) {
    return current - 1;
  }
  if (from > to && current >= to && current < from) {
    return current + 1;
  }
  return current;
}

/** Remove a state and repair only references scoped to that control. */
export function removeVariant(control: ControlConfig, current: number, index: number): number {
  const n = control.variants.length;
  if (n < 2 || index < 0 || index >= n) return current;
  const replacementIndex = Math.min(index, n - 2);
  const removedId = stateIdAt(control, index);
  const replacementId = stateIdAt(control, replacementIndex);
  control.variants.splice(index, 1);

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
  if (current === index) {
    return replacementIndex;
  }
  return current > index ? current - 1 : current;
}

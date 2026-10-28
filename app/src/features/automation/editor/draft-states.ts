// Rules for a scenario draft's states, Off/On roles and binding. Each returns a new draft and never mutates its input.
import { MAX_VARIANTS, type ControlConfig, type Variant } from '../../controls/model';
import { moveVariant, removeVariant, stateIdAt } from '../../controls/variants';
import { clonePlain } from '../plain-data';
import { newId, type StateRoles } from '../scenario';
import type { VariableSnapshot } from '../variables';
import type { ScenarioDraft } from './scenario-edit';

type Records = VariableSnapshot['records'];

/** A new state that starts with `source`'s appearance, a fresh ID and an empty label. */
export function newStateFrom(source: Variant): Variant {
  const variant = { ...clonePlain(source), id: newId(), label: '' };
  delete variant.action;
  delete variant.value;
  return variant;
}

export function withAddedState(draft: ScenarioDraft): ScenarioDraft | undefined {
  if (!draft.variants.length || draft.variants.length >= MAX_VARIANTS) {
    return undefined;
  }
  return { ...draft, variants: [...draft.variants, newStateFrom(draft.variants.at(-1)!)] };
}

/** Sets or clears the Off/On roles; undefined when the roles name missing or equal states. */
export function withRoles(
  draft: ScenarioDraft,
  control: ControlConfig,
  roles: StateRoles | undefined,
  records: Records,
): ScenarioDraft | undefined {
  const next = clonePlain(draft);
  const ids = next.variants.map((_, index) =>
    stateIdAt({ ...control, variants: next.variants }, index),
  );
  if (roles && (roles.off === roles.on || !ids.includes(roles.off) || !ids.includes(roles.on))) {
    return undefined;
  }
  if (roles) {
    next.stateRoles = roles;
  } else {
    delete next.stateRoles;
  }
  syncBooleanBinding(next, records);
  return next;
}

/** Turns Off/On roles on (using the first two states, adding one if needed) or off. */
export function withToggledRoles(
  draft: ScenarioDraft,
  control: ControlConfig,
  records: Records,
): ScenarioDraft | undefined {
  if (draft.stateRoles) {
    return withRoles(draft, control, undefined, records);
  }
  const next = clonePlain(draft);
  if (next.variants.length < 2) {
    next.variants.push(newStateFrom(next.variants[0]));
  }
  const working = { ...control, variants: next.variants };
  next.stateRoles = { off: stateIdAt(working, 0), on: stateIdAt(working, 1) };
  syncBooleanBinding(next, records);
  return next;
}

/** `control` must be a plain snapshot; `liveStateId` is the state the button shows. */
export function withMovedState(
  draft: ScenarioDraft,
  control: ControlConfig,
  liveStateId: string,
  from: number,
  to: number,
): ScenarioDraft {
  const next = clonePlain(draft);
  const working = { ...structuredClone(control), ...next };
  const current = next.variants.findIndex((_, index) => stateIdAt(working, index) === liveStateId);
  moveVariant(working, current, from, to);
  return { ...next, variants: working.variants };
}

/**
 * Deletes a state and repairs references to it. `control` must be a plain snapshot. Returns the
 * removed state's ID and the state that replaces the live one.
 */
export function withoutState(
  draft: ScenarioDraft,
  control: ControlConfig,
  liveStateId: string,
  index: number,
) {
  const removedId = stateIdAt({ ...control, variants: draft.variants }, index);
  const next = clonePlain(draft);
  const working = { ...structuredClone(control), ...next };
  const liveIndex = working.variants.findIndex((_, i) => stateIdAt(working, i) === liveStateId);
  const replacementIndex = removeVariant(working, liveIndex < 0 ? 0 : liveIndex, index);
  return {
    draft: {
      ...next,
      variants: working.variants,
      scenario: working.scenario,
      stateBinding: working.stateBinding,
      stateRoles: working.stateRoles,
    },
    removedId,
    replacementId: stateIdAt(working, replacementIndex),
  };
}

/** A Boolean binding follows the Off/On roles: false shows Off, true shows On. */
function syncBooleanBinding(next: ScenarioDraft, records: Records) {
  const binding = next.stateBinding;
  const roles = next.stateRoles;
  const record = binding && records[binding.variableId];
  if (binding && roles && record?.definition.type === 'boolean') {
    next.stateBinding = {
      ...binding,
      cases: [
        { value: false, stateId: roles.off },
        { value: true, stateId: roles.on },
      ],
    };
  }
}

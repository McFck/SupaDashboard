import type { ControlConfig, Variant } from '../../controls/model';
import {
  emptyScenario,
  newId,
  walkSteps,
  type ActionStep,
  type Scenario,
  type StateBinding,
  type StateRoles,
  type Trigger,
} from '../scenario';
import { clonePlain } from '../plain-data';

export type ScenarioDraft = {
  scenario: Scenario;
  variants: Variant[];
  stateBindings?: StateBinding[];
  stateRoles?: StateRoles;
};
export type Branch = { stepId: string; arm: 'then' | 'else' };
export type ScenarioListOwner =
  { kind: 'trigger'; trigger: Trigger } | { kind: 'event'; eventId: string };
export type StepListPath = ScenarioListOwner & { stateId?: string; branches?: Branch[] };

export function createScenarioDraft(control: ControlConfig): ScenarioDraft {
  return clonePlain({
    scenario: control.scenario ?? emptyScenario(),
    variants: control.variants,
    ...(control.stateBindings ? { stateBindings: control.stateBindings } : {}),
    ...(control.stateRoles ? { stateRoles: control.stateRoles } : {}),
  });
}

export function sameScenarioDraft(a: ScenarioDraft, b: ScenarioDraft) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function listOf(scenario: Scenario, path: ScenarioListOwner) {
  return path.kind === 'trigger'
    ? scenario.triggers[path.trigger]
    : scenario.events.find((event) => event.id === path.eventId)?.list;
}

function listAt(scenario: Scenario, path: StepListPath, create: boolean) {
  let list = listOf(scenario, path);
  if (!list && path.kind === 'trigger' && create)
    list = scenario.triggers[path.trigger] = { steps: [] };
  if (!list) throw new Error('Scenario list is unavailable');
  let steps = list.steps;
  if (path.stateId !== undefined) {
    list.byState ??= {};
    if (!Object.hasOwn(list.byState, path.stateId) && create) list.byState[path.stateId] = [];
    const override = list.byState[path.stateId];
    if (!override) throw new Error('State override is unavailable');
    steps = override;
  }
  for (const branch of path.branches ?? []) {
    const parent = steps.find((step) => step.id === branch.stepId);
    if (!parent || parent.kind !== 'if') throw new Error('Condition branch is unavailable');
    steps = parent[branch.arm];
  }
  return steps;
}

export function scenarioStepsAt(scenario: Scenario, path: StepListPath): ActionStep[] {
  try {
    return listAt(scenario, path, false);
  } catch {
    return [];
  }
}

function editList(
  scenario: Scenario,
  path: StepListPath,
  edit: (steps: ActionStep[]) => void,
  create = false,
) {
  const next = clonePlain(scenario);
  edit(listAt(next, path, create));
  return next;
}

function duplicateId(scenario: Scenario, id: string) {
  let found = false;
  walkSteps(scenario, (step) => {
    found ||= step.id === id;
  });
  return found;
}

export function insertScenarioStep(
  scenario: Scenario,
  path: StepListPath,
  step: ActionStep,
  index?: number,
) {
  if (!step.id || duplicateId(scenario, step.id)) throw new Error('Step ID must be unique');
  return editList(
    scenario,
    path,
    (steps) => {
      const at = index ?? steps.length;
      if (!Number.isInteger(at) || at < 0 || at > steps.length)
        throw new Error('Step position is invalid');
      steps.splice(at, 0, clonePlain(step));
    },
    true,
  );
}

export function removeScenarioStep(scenario: Scenario, path: StepListPath, stepId: string) {
  return editList(scenario, path, (steps) => {
    const index = steps.findIndex((step) => step.id === stepId);
    if (index < 0) throw new Error('Step is unavailable');
    steps.splice(index, 1);
  });
}

export function replaceScenarioStep(
  scenario: Scenario,
  path: StepListPath,
  stepId: string,
  replacement: ActionStep,
) {
  return editList(scenario, path, (steps) => {
    const index = steps.findIndex((step) => step.id === stepId);
    if (index < 0) throw new Error('Step is unavailable');
    steps[index] = { ...clonePlain(replacement), id: stepId };
  });
}

export function moveScenarioStep(
  scenario: Scenario,
  path: StepListPath,
  stepId: string,
  destination: number,
) {
  return editList(scenario, path, (steps) => {
    const from = steps.findIndex((step) => step.id === stepId);
    if (
      from < 0 ||
      !Number.isInteger(destination) ||
      destination < 0 ||
      destination >= steps.length
    )
      throw new Error('Step position is invalid');
    if (from === destination) return;
    const [step] = steps.splice(from, 1);
    steps.splice(destination, 0, step);
  });
}

/** Moves a step, with everything inside it, to `index` of another list (or the same one); `index` counts the target after the step left. */
export function moveScenarioStepTo(
  scenario: Scenario,
  from: StepListPath,
  stepId: string,
  to: StepListPath,
  index: number,
) {
  if (to.branches?.some((branch) => branch.stepId === stepId)) {
    throw new Error('A step cannot move into itself');
  }
  const next = clonePlain(scenario);
  const source = listAt(next, from, false);
  const at = source.findIndex((step) => step.id === stepId);
  if (at < 0) throw new Error('Step is unavailable');
  const [step] = source.splice(at, 1);
  const target = listAt(next, to, false);
  if (!Number.isInteger(index) || index < 0 || index > target.length)
    throw new Error('Step position is invalid');
  target.splice(index, 0, step);
  return next;
}

/**
 * The keyboard move across branch borders, following the order the steps read in: down enters a Condition below
 * (its Then), leaves the end of Then for Else and the end of Else for after the Condition; up mirrors that.
 * Undefined when the step simply stays in its list.
 */
export function shiftScenarioStep(
  scenario: Scenario,
  path: StepListPath,
  stepId: string,
  direction: -1 | 1,
) {
  const steps = scenarioStepsAt(scenario, path);
  const at = steps.findIndex((step) => step.id === stepId);
  if (at < 0) return undefined;
  const neighbour = steps[at + direction];
  const branches = path.branches ?? [];
  const outerBranches = branches.slice(0, -1);
  const arm = (base: Branch[], step: ActionStep, which: Branch['arm']): StepListPath => ({
    ...path,
    branches: [...base, { stepId: step.id, arm: which }],
  });
  if (neighbour?.kind === 'if') {
    return moveScenarioStepTo(
      scenario,
      path,
      stepId,
      arm(branches, neighbour, direction > 0 ? 'then' : 'else'),
      direction > 0 ? 0 : neighbour.else.length,
    );
  }
  const parent = branches.at(-1);
  if (neighbour || !parent) return undefined;
  const outer = { ...path, branches: outerBranches };
  const siblings = scenarioStepsAt(scenario, outer);
  const parentIndex = siblings.findIndex((step) => step.id === parent.stepId);
  const condition = siblings[parentIndex];
  if (condition?.kind !== 'if') return undefined;
  if (direction > 0 && parent.arm === 'then') {
    return moveScenarioStepTo(scenario, path, stepId, arm(outerBranches, condition, 'else'), 0);
  }
  if (direction < 0 && parent.arm === 'else') {
    return moveScenarioStepTo(
      scenario,
      path,
      stepId,
      arm(outerBranches, condition, 'then'),
      condition.then.length,
    );
  }
  return moveScenarioStepTo(scenario, path, stepId, outer, parentIndex + (direction > 0 ? 1 : 0));
}

export function setScenarioStateOverride(
  scenario: Scenario,
  path: ScenarioListOwner,
  stateId: string,
  steps: ActionStep[] | undefined,
) {
  const next = clonePlain(scenario);
  const list = listOf(next, path);
  if (!list) throw new Error('Scenario list is unavailable');
  list.byState ??= {};
  if (steps === undefined) delete list.byState[stateId];
  else list.byState[stateId] = clonePlain(steps);
  if (!Object.keys(list.byState).length) delete list.byState;
  return next;
}

/** A copy of `steps` with fresh IDs throughout, so it can live beside the original in one scenario. */
export function withNewStepIds(steps: ActionStep[]): ActionStep[] {
  return steps.map((step) => {
    const copy = { ...clonePlain(step), id: newId() };
    if (copy.kind === 'if') {
      copy.then = withNewStepIds(copy.then);
      copy.else = withNewStepIds(copy.else);
    }
    return copy;
  });
}

export function scenarioPathKey(path: StepListPath) {
  return [
    path.kind,
    path.kind === 'trigger' ? path.trigger : path.eventId,
    path.stateId ?? '*',
    ...(path.branches ?? []).flatMap((branch) => [branch.stepId, branch.arm]),
  ].join(':');
}

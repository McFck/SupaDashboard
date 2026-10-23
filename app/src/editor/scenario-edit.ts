import type { ControlConfig, Variant } from '../core/controls';
import { emptyScenario, type ActionStep, type Scenario, type StateBinding, type StateRoles, type Trigger } from '../core/scenario';

export type ScenarioDraft = {
  scenario: Scenario;
  variants: Variant[];
  stateBinding?: StateBinding;
  stateRoles?: StateRoles;
};
export type Branch = { stepId: string; arm: 'then' | 'else' };
export type ScenarioListOwner = { kind: 'trigger'; trigger: Trigger } | { kind: 'event'; eventId: string };
export type StepListPath = (ScenarioListOwner & { stateId?: string; branches?: Branch[] });

export function cloneDraftValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => cloneDraftValue(item)) as T;
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) copy[key] = cloneDraftValue(child);
    return copy as T;
  }
  return value;
}

export function createScenarioDraft(control: ControlConfig): ScenarioDraft {
  return cloneDraftValue({ scenario: control.scenario ?? emptyScenario(), variants: control.variants,
    ...(control.stateBinding ? { stateBinding: control.stateBinding } : {}),
    ...(control.stateRoles ? { stateRoles: control.stateRoles } : {}) });
}

export function sameScenarioDraft(a: ScenarioDraft, b: ScenarioDraft) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function listAt(scenario: Scenario, path: StepListPath, create: boolean) {
  let list = path.kind === 'trigger' ? scenario.triggers[path.trigger] : scenario.events.find(event => event.id === path.eventId)?.list;
  if (!list && path.kind === 'trigger' && create) list = scenario.triggers[path.trigger] = { steps: [] };
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
    const parent = steps.find(step => step.id === branch.stepId);
    if (!parent || parent.kind !== 'if') throw new Error('Condition branch is unavailable');
    steps = parent[branch.arm];
  }
  return steps;
}

export function scenarioStepsAt(scenario: Scenario, path: StepListPath): ActionStep[] {
  try { return listAt(scenario, path, false); }
  catch { return []; }
}

function editList(scenario: Scenario, path: StepListPath, edit: (steps: ActionStep[]) => void, create = false) {
  const next = cloneDraftValue(scenario);
  edit(listAt(next, path, create));
  return next;
}

function duplicateId(scenario: Scenario, id: string) {
  const visit = (steps: ActionStep[]): boolean => steps.some(step => step.id === id ||
    step.kind === 'if' && (visit(step.then) || visit(step.else)));
  return Object.values(scenario.triggers).some(list => !!list && (visit(list.steps) ||
    Object.values(list.byState ?? {}).some(visit))) || scenario.events.some(event =>
    visit(event.list.steps) || Object.values(event.list.byState ?? {}).some(visit));
}

export function insertScenarioStep(scenario: Scenario, path: StepListPath, step: ActionStep, index?: number) {
  if (!step.id || duplicateId(scenario, step.id)) throw new Error('Step ID must be unique');
  return editList(scenario, path, steps => {
    const at = index ?? steps.length;
    if (!Number.isInteger(at) || at < 0 || at > steps.length) throw new Error('Step position is invalid');
    steps.splice(at, 0, cloneDraftValue(step));
  }, true);
}

export function removeScenarioStep(scenario: Scenario, path: StepListPath, stepId: string) {
  return editList(scenario, path, steps => {
    const index = steps.findIndex(step => step.id === stepId);
    if (index < 0) throw new Error('Step is unavailable');
    steps.splice(index, 1);
  });
}

export function replaceScenarioStep(scenario: Scenario, path: StepListPath, stepId: string, replacement: ActionStep) {
  return editList(scenario, path, steps => {
    const index = steps.findIndex(step => step.id === stepId);
    if (index < 0) throw new Error('Step is unavailable');
    steps[index] = { ...cloneDraftValue(replacement), id: stepId };
  });
}

export function moveScenarioStep(scenario: Scenario, path: StepListPath, stepId: string, destination: number) {
  return editList(scenario, path, steps => {
    const from = steps.findIndex(step => step.id === stepId);
    if (from < 0 || !Number.isInteger(destination) || destination < 0 || destination >= steps.length)
      throw new Error('Step position is invalid');
    if (from === destination) return;
    const [step] = steps.splice(from, 1);
    steps.splice(destination, 0, step);
  });
}

export function setScenarioStateOverride(scenario: Scenario, path: ScenarioListOwner,
  stateId: string, steps: ActionStep[] | undefined) {
  const next = cloneDraftValue(scenario);
  const list = path.kind === 'trigger' ? next.triggers[path.trigger] : next.events.find(event => event.id === path.eventId)?.list;
  if (!list) throw new Error('Scenario list is unavailable');
  list.byState ??= {};
  if (steps === undefined) delete list.byState[stateId];
  else list.byState[stateId] = cloneDraftValue(steps);
  if (!Object.keys(list.byState).length) delete list.byState;
  return next;
}

export function scenarioStepCount(steps: ActionStep[]): number {
  return steps.reduce((count, step) => count + 1 + (step.kind === 'if'
    ? scenarioStepCount(step.then) + scenarioStepCount(step.else) : 0), 0);
}

export function scenarioNodeCount(scenario: Scenario) {
  return Object.values(scenario.triggers).reduce((count, list) => count + (list
    ? scenarioStepCount(list.steps) + Object.values(list.byState ?? {}).reduce((sum, steps) => sum + scenarioStepCount(steps), 0) : 0), 0) +
    scenario.events.reduce((count, event) => count + scenarioStepCount(event.list.steps) +
      Object.values(event.list.byState ?? {}).reduce((sum, steps) => sum + scenarioStepCount(steps), 0), 0);
}

export function scenarioPathKey(path: StepListPath) {
  return [path.kind, path.kind === 'trigger' ? path.trigger : path.eventId, path.stateId ?? '*',
    ...(path.branches ?? []).flatMap(branch => [branch.stepId, branch.arm])].join(':');
}

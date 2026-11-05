import type { ActionRef } from '../plugins/contracts';
import type { EffectId } from '../effects/catalogue';
import { isRecord } from './plain-data';

export type Trigger =
  | 'press'
  | 'release'
  | 'longPress'
  | 'longPressRelease'
  | 'doubleTap'
  | 'swipeUp'
  | 'swipeDown'
  | 'swipeLeft'
  | 'swipeRight';

export type Scalar = boolean | number | string;

export type Operand =
  | { kind: 'literal'; value: Scalar }
  | { kind: 'variable'; id: string }
  | { kind: 'state'; controlId: 'self' | string };

export type Predicate =
  | { kind: 'compare'; left: Operand; op: 'eq' | 'ne' | 'gt' | 'lt'; right: Operand }
  | { kind: 'expression'; source: string };

export type ActionStep = { effect?: EffectId } & (
  | { id: string; kind: 'action'; action: ActionRef }
  | { id: string; kind: 'delay'; ms: number }
  | { id: string; kind: 'if'; condition: Predicate; then: ActionStep[]; else: ActionStep[] }
);

export type TriggerList = {
  effect?: EffectId;
  steps: ActionStep[];
  byState?: Record<string, ActionStep[]>;
};

export type EventList = { id: string; eventId: string; parameter?: string; list: TriggerList };

export type Scenario = { triggers: Partial<Record<Trigger, TriggerList>>; events: EventList[] };

export type StateBinding = { variableId: string; cases: { value: Scalar; stateId: string }[] };

export type StateRoles = { off: string; on: string };

export type ScenarioIssue = { path: string; message: string };

export const TRIGGERS: readonly Trigger[] = [
  'press',
  'release',
  'longPress',
  'longPressRelease',
  'doubleTap',
  'swipeUp',
  'swipeDown',
  'swipeLeft',
  'swipeRight',
];

export const TRIGGER_LABELS: Readonly<Record<Trigger, string>> = {
  press: 'Press',
  release: 'Release',
  longPress: 'Long press',
  longPressRelease: 'Long press release',
  doubleTap: 'Double tap',
  swipeUp: 'Pull up',
  swipeDown: 'Pull down',
  swipeLeft: 'Pull left',
  swipeRight: 'Pull right',
};

export const MAX_SCENARIO_DEPTH = 16;

export const MAX_SCENARIO_NODES = 1000;

export const MAX_DELAY_MS = 86_400_000;

export function isValidDelay(ms: unknown): ms is number {
  return Number.isInteger(ms) && (ms as number) >= 0 && (ms as number) <= MAX_DELAY_MS;
}

export const emptyScenario = (): Scenario => ({ triggers: {}, events: [] });

/** randomUUID needs a secure context; the fallback keeps IDs unique on plain-HTTP origins too. */
export function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function selectTriggerSteps(
  list: TriggerList | undefined,
  stateId: string,
): ActionStep[] | undefined {
  if (!list) return undefined;
  return list.byState && Object.hasOwn(list.byState, stateId) ? list.byState[stateId] : list.steps;
}

function visitSteps(steps: ActionStep[], visit: (step: ActionStep) => void) {
  for (const step of steps) {
    visit(step);
    if (step.kind === 'if') {
      visitSteps(step.then, visit);
      visitSteps(step.else, visit);
    }
  }
}

export function walkSteps(scenario: Scenario, visit: (step: ActionStep) => void) {
  const lists = [
    ...Object.values(scenario.triggers),
    ...scenario.events.map((event) => event.list),
  ];
  for (const list of lists) {
    if (list) {
      visitSteps(list.steps, visit);
      for (const steps of Object.values(list.byState ?? {})) {
        visitSteps(steps, visit);
      }
    }
  }
}

/** Steps in a list, counting the steps inside Condition branches. */
export function scenarioStepCount(steps: ActionStep[]): number {
  let count = 0;
  visitSteps(steps, () => count++);
  return count;
}

/** Steps of a trigger or event list: common and per-state, with nested branches. */
export function listStepCount(list: TriggerList | undefined) {
  if (!list) {
    return 0;
  }
  let count = scenarioStepCount(list.steps);
  for (const steps of Object.values(list.byState ?? {})) {
    count += scenarioStepCount(steps);
  }
  return count;
}

/** A trigger list with no steps, no per-state override and no effect does nothing, so it counts as absent. */
export function isEmptyList(list: TriggerList | undefined) {
  return !list || (!list.effect && !list.steps.length && !Object.keys(list.byState ?? {}).length);
}

/** All steps of a scenario, the quantity MAX_SCENARIO_NODES bounds. */
export function scenarioNodeCount(scenario: Scenario) {
  let count = 0;
  walkSteps(scenario, () => count++);
  return count;
}

export function actionRef(value: unknown): value is ActionRef {
  return isRecord(value) && typeof value.id === 'string';
}

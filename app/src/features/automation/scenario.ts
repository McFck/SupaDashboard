import type { ActionRef } from '../plugins/contracts';
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

export type ActionStep =
  | { id: string; kind: 'action'; action: ActionRef }
  | { id: string; kind: 'delay'; ms: number }
  | { id: string; kind: 'if'; condition: Predicate; then: ActionStep[]; else: ActionStep[] };

export type TriggerList = { steps: ActionStep[]; byState?: Record<string, ActionStep[]> };

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

export function actionRef(value: unknown): value is ActionRef {
  return isRecord(value) && typeof value.id === 'string';
}

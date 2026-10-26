import type { ActionRef } from '../plugins/contracts';
import type { ControlConfig } from '../controls/model';
import { compileExpression } from './templates';

export type Trigger = 'press' | 'release' | 'longPress' | 'longPressRelease' | 'doubleTap'
  | 'swipeUp' | 'swipeDown' | 'swipeLeft' | 'swipeRight';
export type Scalar = boolean | number | string;
export type Operand = { kind: 'literal'; value: Scalar } | { kind: 'variable'; id: string }
  | { kind: 'state'; controlId: 'self' | string };
export type Predicate = { kind: 'compare'; left: Operand; op: 'eq' | 'ne' | 'gt' | 'lt'; right: Operand }
  | { kind: 'expression'; source: string };
export type ActionStep = { id: string; kind: 'action'; action: ActionRef }
  | { id: string; kind: 'delay'; ms: number }
  | { id: string; kind: 'if'; condition: Predicate; then: ActionStep[]; else: ActionStep[] };
export type TriggerList = { steps: ActionStep[]; byState?: Record<string, ActionStep[]> };
export type EventList = { id: string; eventId: string; parameter?: string; list: TriggerList };
export type Scenario = { triggers: Partial<Record<Trigger, TriggerList>>; events: EventList[] };
export type StateBinding = { variableId: string; cases: { value: Scalar; stateId: string }[] };
export type StateRoles = { off: string; on: string };
export type ScenarioIssue = { path: string; message: string };

export const TRIGGERS: readonly Trigger[] = ['press', 'release', 'longPress', 'longPressRelease', 'doubleTap',
  'swipeUp', 'swipeDown', 'swipeLeft', 'swipeRight'];
export const MAX_SCENARIO_DEPTH = 16;
export const MAX_SCENARIO_NODES = 1000;
export const MAX_DELAY_MS = 86_400_000;

export const emptyScenario = (): Scenario => ({ triggers: {}, events: [] });

export function newScenarioId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('This browser cannot create scenario IDs');
  return globalThis.crypto.randomUUID();
}

export function selectTriggerSteps(list: TriggerList | undefined, stateId: string): ActionStep[] | undefined {
  if (!list) return undefined;
  return list.byState && Object.hasOwn(list.byState, stateId) ? list.byState[stateId] : list.steps;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertAcyclic(value: unknown) {
  const active = new WeakSet<object>();
  const done = new WeakSet<object>();
  const stack: { value: unknown; leaving: boolean }[] = [{ value, leaving: false }];
  while (stack.length) {
    const item = stack.pop()!;
    if (!item.value || typeof item.value !== 'object') continue;
    const object = item.value as object;
    if (item.leaving) { active.delete(object); done.add(object); continue; }
    if (active.has(object)) throw new Error('Control configuration contains a cycle');
    if (done.has(object)) continue;
    active.add(object);
    stack.push({ value: object, leaving: true });
    for (const child of Object.values(object)) stack.push({ value: child, leaving: false });
  }
}

function actionRef(value: unknown): value is ActionRef {
  return isRecord(value) && typeof value.id === 'string';
}

function stableVariantIds(control: Record<string, any>) {
  if (!Array.isArray(control.variants)) control.variants = [];
  const used = new Set<string>();
  for (let i = 0; i < control.variants.length; i++) {
    const variant = isRecord(control.variants[i]) ? control.variants[i] : (control.variants[i] = { label: '' });
    const requested = typeof variant.id === 'string' && variant.id.trim() ? variant.id : `state-${i + 1}`;
    let id = requested, suffix = 2;
    while (used.has(id)) id = `${requested}-${suffix++}`;
    variant.id = id;
    used.add(id);
  }
}

function stepsFromAction(value: unknown, path: string, makeId: (base: string) => string,
  ancestors = new Set<object>(), depth = 0): ActionStep[] {
  if (actionRef(value) && value.id === 'sequence' && Array.isArray(value.args?.steps)) {
    if (depth >= MAX_SCENARIO_DEPTH || ancestors.has(value))
      return [{ id: makeId(path), kind: 'action', action: structuredClone(value) }];
    const next = new Set(ancestors);
    next.add(value);
    const flattened: ActionStep[] = [];
    for (let i = 0; i < value.args.steps.length; i++)
      flattened.push(...stepsFromAction(value.args.steps[i], `${path}-${i + 1}`, makeId, next, depth + 1));
    if (flattened.length + depth > MAX_SCENARIO_NODES)
      return [{ id: makeId(path), kind: 'action', action: structuredClone(value) }];
    return flattened;
  }
  if (actionRef(value) && value.id === 'delay') {
    const ms = value.args?.ms;
    if (typeof ms === 'number' && Number.isInteger(ms) && ms >= 0 && ms <= MAX_DELAY_MS)
      return [{ id: makeId(path), kind: 'delay', ms }];
  }
  return [{ id: makeId(path), kind: 'action', action: structuredClone(value) as ActionRef }];
}

function variantAction(variant: unknown, path: string, makeId: (base: string) => string): ActionStep[] {
  if (!isRecord(variant) || !actionRef(variant.action)) return [];
  return stepsFromAction(variant.action, path, makeId);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function sameMigratedSteps(left: ActionStep[], right: ActionStep[]) {
  const shape = (steps: ActionStep[]): unknown[] => steps.map(step => {
    if (step.kind === 'if') return { kind: step.kind, condition: step.condition,
      then: shape(step.then), else: shape(step.else) };
    if (step.kind === 'delay') return { kind: step.kind, ms: step.ms };
    return { kind: step.kind, action: step.action };
  });
  return JSON.stringify(stableValue(shape(left))) === JSON.stringify(stableValue(shape(right)));
}

function legacyVariantAction(variant: unknown, variants: unknown[], path: string, makeId: (base: string) => string): ActionStep[] {
  if (!isRecord(variant) || !('variant' in variant)) return [];
  const value = variant.variant;
  const index = variants.length ? ((Number(value) % variants.length) + variants.length) % variants.length : 0;
  const state = typeof value === 'number'
    ? (isRecord(variants[index]) && typeof variants[index].id === 'string' ? variants[index].id : `state-${index + 1}`)
    : value;
  if (state !== 'next' && state !== 'prev' && typeof state !== 'string') return [];
  return stepsFromAction({ id: 'button.variant', args: { target: 'self', variant: state } }, path, makeId);
}

function normalizeSteps(input: unknown, path: string, makeId: (base: string) => string): ActionStep[] {
  if (!Array.isArray(input)) return [];
  return input.map((raw, index) => {
    const step = isRecord(raw) ? raw : {};
    const id = typeof step.id === 'string' && step.id ? makeId(step.id) : makeId(`${path}-${index + 1}`);
    if (step.kind === 'action') return { id, kind: 'action', action: structuredClone(step.action) } as ActionStep;
    if (step.kind === 'delay') return { id, kind: 'delay', ms: step.ms } as ActionStep;
    if (step.kind === 'if') return { id, kind: 'if', condition: structuredClone(step.condition),
      then: normalizeSteps(step.then, `${path}-${index + 1}-then`, makeId),
      else: normalizeSteps(step.else, `${path}-${index + 1}-else`, makeId) } as ActionStep;
    return { id, kind: 'action', action: structuredClone(raw) as ActionRef };
  });
}

function normalizeScenario(input: unknown, makeId: (base: string) => string): Scenario {
  const raw = isRecord(input) ? input : {};
  const triggers: Partial<Record<Trigger, TriggerList>> = {};
  for (const trigger of TRIGGERS) {
    const list = raw.triggers?.[trigger];
    if (!isRecord(list)) continue;
    const byState: Record<string, ActionStep[]> = {};
    if (isRecord(list.byState)) for (const [stateId, steps] of Object.entries(list.byState))
      byState[stateId] = normalizeSteps(steps, `${trigger}-${stateId}`, makeId);
    triggers[trigger] = { steps: normalizeSteps(list.steps, trigger, makeId),
      ...(isRecord(list.byState) ? { byState } : {}) };
  }
  const events = Array.isArray(raw.events) ? raw.events.map((event, i) => {
    const entry = isRecord(event) ? event : {};
    return { id: typeof entry.id === 'string' && entry.id ? makeId(entry.id) : makeId(`event-${i + 1}`),
      eventId: typeof entry.eventId === 'string' ? entry.eventId : '',
      ...(typeof entry.parameter === 'string' ? { parameter: entry.parameter } : {}),
      list: normalizeScenario({ triggers: { press: entry.list }, events: [] }, makeId).triggers.press ?? { steps: [] } };
  }) : [];
  return { triggers, events };
}

function migrateLegacy(input: Record<string, any>, makeId: (base: string) => string): Scenario {
  const triggers: Partial<Record<Trigger, TriggerList>> = {};
  const gestures = isRecord(input.gestures) ? input.gestures : {};
  const explicitTap = Object.hasOwn(gestures, 'tap') && gestures.tap != null;
  if (explicitTap) {
    const value = gestures.tap;
    const steps = isRecord(value) && 'variant' in value
      ? legacyVariantAction(value, input.variants ?? [], 'press', makeId)
      : stepsFromAction(value, 'press', makeId);
    triggers.press = { steps };
  } else {
    const migrated: ActionStep[][] = (input.variants ?? []).map((variant: unknown, index: number) =>
      variantAction(variant, `press-${index + 1}`, makeId));
    if (migrated.length && migrated[0].length && migrated.every(steps => sameMigratedSteps(steps, migrated[0]))) {
      triggers.press = { steps: migrated[0] };
    } else {
    const byState: Record<string, ActionStep[]> = {};
      for (let i = 0; i < migrated.length; i++) {
        const steps = migrated[i];
        if (steps.length) byState[input.variants[i].id] = steps;
      }
      if (Object.keys(byState).length) triggers.press = { steps: [], byState };
    }
  }
  const map: Partial<Record<string, Trigger>> = { doubleTap: 'doubleTap', longPress: 'longPress',
    swipeUp: 'swipeUp', swipeDown: 'swipeDown', swipeLeft: 'swipeLeft', swipeRight: 'swipeRight' };
  for (const [gesture, trigger] of Object.entries(map)) {
    const binding = gestures[gesture];
    if (!trigger || !binding) continue;
    const steps = isRecord(binding) && 'variant' in binding
      ? legacyVariantAction(binding, input.variants ?? [], trigger, makeId)
      : stepsFromAction(binding, trigger, makeId);
    triggers[trigger] = { steps };
  }
  return { triggers, events: [] };
}

/** Convert old control fields at the settings/plugin boundary; runtime code only reads the canonical tree. */
export function normalizeControl(input: unknown): ControlConfig {
  if (!isRecord(input)) throw new Error('Control configuration must be an object');
  assertAcyclic(input);
  const control = structuredClone(input) as Record<string, any>;
  stableVariantIds(control);
  const usedStepIds = new Set<string>();
  const makeId = (base: string) => {
    const clean = base.replace(/[^a-zA-Z0-9_-]/g, '-') || 'step';
    let id = clean, suffix = 2;
    while (usedStepIds.has(id)) id = `${clean}-${suffix++}`;
    usedStepIds.add(id);
    return id;
  };
  control.scenario = control.scenario === undefined
    ? migrateLegacy(control, makeId)
    : normalizeScenario(control.scenario, makeId);
  for (const variant of control.variants) delete variant.action;
  delete control.gestures;
  delete control.color;
  if (control.stateRoles) {
    const ids = new Set(control.variants.map((variant: any) => variant.id));
    if (!ids.has(control.stateRoles.off) || !ids.has(control.stateRoles.on) || control.stateRoles.off === control.stateRoles.on)
      delete control.stateRoles;
  }
  return control as ControlConfig;
}

export function validateScenario(value: unknown): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  const ids = new Set<string>();
  let count = 0;
  const inspectLegacy = (steps: unknown[], path: string, depth: number) => {
    for (let i = 0; i < steps.length; i++) {
      const legacy = steps[i];
      const stepPath = `${path}.${i}`;
      count++;
      if (count > MAX_SCENARIO_NODES) issues.push({ path: stepPath, message: 'Scenario exceeds 1000 steps' });
      if (depth > MAX_SCENARIO_DEPTH) { issues.push({ path: stepPath, message: 'Scenario exceeds 16 levels' }); continue; }
      if (!actionRef(legacy)) continue;
      if (legacy.id === 'sequence') {
        if (Array.isArray(legacy.args?.steps)) inspectLegacy(legacy.args.steps, stepPath, depth + 1);
        else issues.push({ path: stepPath, message: 'Action sequence is invalid' });
      } else if (legacy.id === 'delay') {
        const ms = legacy.args?.ms;
        if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > MAX_DELAY_MS)
          issues.push({ path: stepPath, message: 'Wait duration must be an integer from 0 to 86400000' });
      }
    }
  };
  const visit = (steps: unknown, path: string, depth: number) => {
    if (!Array.isArray(steps)) { issues.push({ path, message: 'Expected a step list' }); return; }
    for (let i = 0; i < steps.length; i++) {
      const stepPath = `${path}.${i}`;
      const step = steps[i];
      count++;
      if (count > MAX_SCENARIO_NODES) issues.push({ path: stepPath, message: 'Scenario exceeds 1000 steps' });
      if (depth > MAX_SCENARIO_DEPTH) issues.push({ path: stepPath, message: 'Scenario exceeds 16 levels' });
      if (!isRecord(step) || typeof step.id !== 'string' || !step.id) {
        issues.push({ path: stepPath, message: 'Step ID is missing' });
        continue;
      }
      if (ids.has(step.id)) issues.push({ path: stepPath, message: 'Step IDs must be unique' });
      ids.add(step.id);
      if (step.kind === 'action') {
        if (!actionRef(step.action)) issues.push({ path: stepPath, message: 'Action reference is invalid' });
        else if (step.action.id === 'delay') {
          const ms = step.action.args?.ms;
          if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > MAX_DELAY_MS)
            issues.push({ path: stepPath, message: 'Wait duration must be an integer from 0 to 86400000' });
        } else if (step.action.id === 'sequence') {
          if (!Array.isArray(step.action.args?.steps)) issues.push({ path: stepPath, message: 'Action sequence is invalid' });
          else inspectLegacy(step.action.args.steps, stepPath, depth + 1);
        }
      } else if (step.kind === 'delay') {
        if (typeof step.ms !== 'number' || !Number.isInteger(step.ms) || step.ms < 0 || step.ms > MAX_DELAY_MS)
          issues.push({ path: stepPath, message: 'Wait duration must be an integer from 0 to 86400000' });
      } else if (step.kind === 'if') {
        if (!isRecord(step.condition)) issues.push({ path: stepPath, message: 'Condition is invalid' });
        else if (step.condition.kind === 'expression') {
          if (typeof step.condition.source !== 'string') issues.push({ path: stepPath, message: 'Expression is invalid' });
          else try { compileExpression(step.condition.source); }
          catch (error) { issues.push({ path: stepPath, message: error instanceof Error ? error.message : 'Expression is invalid' }); }
        } else if (step.condition.kind === 'compare') {
          const validOperand = (operand: unknown) => isRecord(operand) && (
            operand.kind === 'literal' && (typeof operand.value === 'boolean' || typeof operand.value === 'string' ||
              typeof operand.value === 'number' && Number.isFinite(operand.value) || operand.value === null) ||
            operand.kind === 'variable' && typeof operand.id === 'string' && !!operand.id ||
            operand.kind === 'state' && typeof operand.controlId === 'string' && !!operand.controlId);
          if (!['eq', 'ne', 'gt', 'lt'].includes(step.condition.op) || !validOperand(step.condition.left) || !validOperand(step.condition.right))
            issues.push({ path: stepPath, message: 'Condition is invalid' });
          else if ((step.condition.left.kind === 'state' || step.condition.right.kind === 'state') &&
            step.condition.op !== 'eq' && step.condition.op !== 'ne')
            issues.push({ path: stepPath, message: 'State values support equality only' });
        } else issues.push({ path: stepPath, message: 'Condition is invalid' });
        visit(step.then, `${stepPath}.then`, depth + 1);
        visit(step.else, `${stepPath}.else`, depth + 1);
      } else issues.push({ path: stepPath, message: 'Step type is unavailable' });
    }
  };
  const walkList = (list: unknown, path: string) => {
    if (!isRecord(list)) return;
    visit(list.steps, `${path}.steps`, 1);
    if (isRecord(list.byState)) for (const [stateId, steps] of Object.entries(list.byState))
      visit(steps, `${path}.byState.${stateId}`, 1);
  };
  const scenario = isRecord(value) ? value : {};
  if (isRecord(scenario.triggers)) for (const [trigger, list] of Object.entries(scenario.triggers)) walkList(list, `triggers.${trigger}`);
  if (Array.isArray(scenario.events)) scenario.events.forEach((event, i) => {
    if (isRecord(event)) walkList(event.list, `events.${i}`);
  });
  return issues;
}

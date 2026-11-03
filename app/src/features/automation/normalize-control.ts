import type { ControlConfig } from '../controls/model';
import { migrateLegacy, stepsFromAction } from './legacy-scenario';
import { isRecord } from './plain-data';
import { isEffectId } from '../effects/catalogue';
import { normalizeEffects } from '../effects/scenario-effects';
import {
  TRIGGERS,
  type ActionStep,
  type Scenario,
  type Trigger,
  type TriggerList,
} from './scenario';

function assertAcyclic(value: unknown) {
  const active = new WeakSet<object>();
  const done = new WeakSet<object>();
  const stack: { value: unknown; leaving: boolean }[] = [{ value, leaving: false }];
  while (stack.length) {
    const item = stack.pop()!;
    if (!item.value || typeof item.value !== 'object') continue;
    const object = item.value as object;
    if (item.leaving) {
      active.delete(object);
      done.add(object);
      continue;
    }
    if (active.has(object)) throw new Error('Control configuration contains a cycle');
    if (done.has(object)) continue;
    active.add(object);
    stack.push({ value: object, leaving: true });
    for (const child of Object.values(object)) stack.push({ value: child, leaving: false });
  }
}

function stableVariantIds(control: Record<string, any>) {
  if (!Array.isArray(control.variants)) control.variants = [];
  const used = new Set<string>();
  for (let i = 0; i < control.variants.length; i++) {
    const variant = isRecord(control.variants[i])
      ? control.variants[i]
      : (control.variants[i] = { label: '' });
    const requested =
      typeof variant.id === 'string' && variant.id.trim() ? variant.id : `state-${i + 1}`;
    let id = requested,
      suffix = 2;
    while (used.has(id)) id = `${requested}-${suffix++}`;
    variant.id = id;
    used.add(id);
  }
}

function normalizeSteps(
  input: unknown,
  path: string,
  makeId: (base: string) => string,
): ActionStep[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.flatMap((raw, index): ActionStep[] => {
    const step = isRecord(raw) ? raw : {};
    const base = typeof step.id === 'string' && step.id ? step.id : `${path}-${index + 1}`;
    if (step.kind === 'action') {
      return stepsFromAction(step.action, base, makeId).map((value) => ({
        ...value,
        ...(isEffectId(step.effect) ? { effect: step.effect } : {}),
      }));
    }
    if (step.kind === 'delay') {
      return [
        {
          id: makeId(base),
          kind: 'delay',
          ms: step.ms,
          ...(isEffectId(step.effect) ? { effect: step.effect } : {}),
        } as ActionStep,
      ];
    }
    if (step.kind === 'if') {
      return [
        {
          id: makeId(base),
          kind: 'if',
          ...(isEffectId(step.effect) ? { effect: step.effect } : {}),
          condition: structuredClone(step.condition),
          then: normalizeSteps(step.then, `${path}-${index + 1}-then`, makeId),
          else: normalizeSteps(step.else, `${path}-${index + 1}-else`, makeId),
        } as ActionStep,
      ];
    }
    return stepsFromAction(raw, base, makeId);
  });
}

function normalizeScenario(input: unknown, makeId: (base: string) => string): Scenario {
  const raw = isRecord(input) ? input : {};
  const triggers: Partial<Record<Trigger, TriggerList>> = {};
  for (const trigger of TRIGGERS) {
    const list = raw.triggers?.[trigger];
    if (!isRecord(list)) continue;
    const byState: Record<string, ActionStep[]> = {};
    if (isRecord(list.byState))
      for (const [stateId, steps] of Object.entries(list.byState))
        byState[stateId] = normalizeSteps(steps, `${trigger}-${stateId}`, makeId);
    triggers[trigger] = {
      ...(isEffectId(list.effect) ? { effect: list.effect } : {}),
      steps: normalizeSteps(list.steps, trigger, makeId),
      ...(isRecord(list.byState) ? { byState } : {}),
    };
  }
  const events = Array.isArray(raw.events)
    ? raw.events.map((event, i) => {
        const entry = isRecord(event) ? event : {};
        return {
          id:
            typeof entry.id === 'string' && entry.id ? makeId(entry.id) : makeId(`event-${i + 1}`),
          eventId: typeof entry.eventId === 'string' ? entry.eventId : '',
          ...(typeof entry.parameter === 'string' ? { parameter: entry.parameter } : {}),
          list: normalizeScenario({ triggers: { press: entry.list }, events: [] }, makeId).triggers
            .press ?? { steps: [] },
        };
      })
    : [];
  return normalizeEffects({ triggers, events });
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
    let id = clean,
      suffix = 2;
    while (usedStepIds.has(id)) id = `${clean}-${suffix++}`;
    usedStepIds.add(id);
    return id;
  };
  control.scenario =
    control.scenario === undefined
      ? migrateLegacy(control, makeId)
      : normalizeScenario(control.scenario, makeId);
  for (const variant of control.variants) delete variant.action;
  delete control.gestures;
  delete control.color;
  if (control.stateRoles) {
    const ids = new Set(control.variants.map((variant: any) => variant.id));
    if (
      !ids.has(control.stateRoles.off) ||
      !ids.has(control.stateRoles.on) ||
      control.stateRoles.off === control.stateRoles.on
    )
      delete control.stateRoles;
  }
  return control as ControlConfig;
}

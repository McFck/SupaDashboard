import { walkSteps, type Scenario, type TriggerList } from '../automation/scenario';
import { clonePlain } from '../automation/plain-data';
import { listOf, type ScenarioListOwner } from '../automation/editor/scenario-edit';
import { isEffectId, type EffectId } from './catalogue';

export function effectSteps(list: TriggerList) {
  const steps: { id: string; effect?: EffectId; label: string }[] = [];
  walkSteps({ triggers: { press: list }, events: [] }, (step) => {
    steps.push({
      id: step.id,
      effect: step.effect,
      label: step.kind === 'action' ? step.action.id : step.kind,
    });
  });
  return steps;
}

/** Canonical ownership applies to common, per-state and nested action lists together. */
export function normalizeEffects(scenario: Scenario) {
  const next = clonePlain(scenario);
  for (const list of [...Object.values(next.triggers), ...next.events.map((event) => event.list)]) {
    if (!list) {
      continue;
    }
    if (!isEffectId(list.effect)) {
      delete list.effect;
    }
    walkSteps({ triggers: { press: list }, events: [] }, (step) => {
      if (list.effect || !isEffectId(step.effect)) {
        delete step.effect;
      }
    });
  }
  return next;
}

export function setScenarioEffect(
  scenario: Scenario,
  owner: ScenarioListOwner,
  effect: EffectId | undefined,
  stepId?: string,
) {
  const next = clonePlain(scenario);
  if (owner.kind === 'trigger') {
    next.triggers[owner.trigger] ??= { steps: [] };
  }
  const list = listOf(next, owner);
  if (!list) {
    return next;
  }
  if (stepId) {
    walkSteps({ triggers: { press: list }, events: [] }, (step) => {
      if (step.id === stepId) {
        if (effect) {
          delete list.effect;
          step.effect = effect;
        } else {
          delete step.effect;
        }
      }
    });
  } else {
    if (effect) {
      list.effect = effect;
    } else {
      delete list.effect;
    }
  }
  return normalizeEffects(next);
}

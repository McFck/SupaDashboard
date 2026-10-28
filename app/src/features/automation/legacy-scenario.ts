// Converts pre-scenario controls (per-variant actions and gesture bindings) into canonical trigger lists.
import type { ActionRef } from '../plugins/contracts';
import { isRecord } from './plain-data';
import {
  actionRef,
  isValidDelay,
  MAX_SCENARIO_DEPTH,
  MAX_SCENARIO_NODES,
  type ActionStep,
  type Scenario,
  type Trigger,
  type TriggerList,
} from './scenario';

export function stepsFromAction(
  value: unknown,
  path: string,
  makeId: (base: string) => string,
  ancestors = new Set<object>(),
  depth = 0,
): ActionStep[] {
  if (actionRef(value) && value.id === 'sequence' && Array.isArray(value.args?.steps)) {
    if (depth >= MAX_SCENARIO_DEPTH || ancestors.has(value))
      return [{ id: makeId(path), kind: 'action', action: structuredClone(value) }];
    const next = new Set(ancestors);
    next.add(value);
    const flattened: ActionStep[] = [];
    for (let i = 0; i < value.args.steps.length; i++)
      flattened.push(
        ...stepsFromAction(value.args.steps[i], `${path}-${i + 1}`, makeId, next, depth + 1),
      );
    if (flattened.length + depth > MAX_SCENARIO_NODES)
      return [{ id: makeId(path), kind: 'action', action: structuredClone(value) }];
    return flattened;
  }
  if (actionRef(value) && value.id === 'delay') {
    const ms = value.args?.ms;
    if (isValidDelay(ms)) return [{ id: makeId(path), kind: 'delay', ms }];
  }
  if (actionRef(value) && (value.id === 'media.nextSlide' || value.id === 'media.prevSlide')) {
    return [
      {
        id: makeId(path),
        kind: 'action',
        action: {
          ...structuredClone(value),
          id: value.id === 'media.nextSlide' ? 'media.next' : 'media.prev',
          args: {
            ...structuredClone(value.args),
            target: typeof value.args?.target === 'string' ? value.args.target : 'self',
          },
        },
      },
    ];
  }
  return [{ id: makeId(path), kind: 'action', action: structuredClone(value) as ActionRef }];
}

function variantAction(
  variant: unknown,
  path: string,
  makeId: (base: string) => string,
): ActionStep[] {
  if (!isRecord(variant) || !actionRef(variant.action)) return [];
  return stepsFromAction(variant.action, path, makeId);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function sameMigratedSteps(left: ActionStep[], right: ActionStep[]) {
  // Legacy actions only produce flat action/delay lists; generated step IDs differ per variant.
  const shape = (steps: ActionStep[]) => steps.map(({ id: _id, ...step }) => step);
  return JSON.stringify(stableValue(shape(left))) === JSON.stringify(stableValue(shape(right)));
}

function legacyVariantAction(
  variant: unknown,
  variants: unknown[],
  path: string,
  makeId: (base: string) => string,
): ActionStep[] {
  if (!isRecord(variant) || !('variant' in variant)) return [];
  const value = variant.variant;
  const index = variants.length
    ? ((Number(value) % variants.length) + variants.length) % variants.length
    : 0;
  const state =
    typeof value === 'number'
      ? isRecord(variants[index]) && typeof variants[index].id === 'string'
        ? variants[index].id
        : `state-${index + 1}`
      : value;
  if (state !== 'next' && state !== 'prev' && typeof state !== 'string') return [];
  return stepsFromAction(
    { id: 'button.variant', args: { target: 'self', variant: state } },
    path,
    makeId,
  );
}

export function migrateLegacy(
  input: Record<string, any>,
  makeId: (base: string) => string,
): Scenario {
  const triggers: Partial<Record<Trigger, TriggerList>> = {};
  const gestures = isRecord(input.gestures) ? input.gestures : {};
  const explicitTap = Object.hasOwn(gestures, 'tap') && gestures.tap != null;
  if (explicitTap) {
    const value = gestures.tap;
    const steps =
      isRecord(value) && 'variant' in value
        ? legacyVariantAction(value, input.variants ?? [], 'press', makeId)
        : stepsFromAction(value, 'press', makeId);
    triggers.press = { steps };
  } else {
    const migrated: ActionStep[][] = (input.variants ?? []).map((variant: unknown, index: number) =>
      variantAction(variant, `press-${index + 1}`, makeId),
    );
    if (
      migrated.length &&
      migrated[0].length &&
      migrated.every((steps) => sameMigratedSteps(steps, migrated[0]))
    ) {
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
  const map: Partial<Record<string, Trigger>> = {
    doubleTap: 'doubleTap',
    longPress: 'longPress',
    swipeUp: 'swipeUp',
    swipeDown: 'swipeDown',
    swipeLeft: 'swipeLeft',
    swipeRight: 'swipeRight',
  };
  for (const [gesture, trigger] of Object.entries(map)) {
    const binding = gestures[gesture];
    if (!trigger || !binding) continue;
    const steps =
      isRecord(binding) && 'variant' in binding
        ? legacyVariantAction(binding, input.variants ?? [], trigger, makeId)
        : stepsFromAction(binding, trigger, makeId);
    triggers[trigger] = { steps };
  }
  return { triggers, events: [] };
}

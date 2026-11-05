import type { EventAncestry } from '../plugins/contracts';
import type { ControlConfig } from '../controls/model';
import {
  TRIGGERS,
  isEmptyList,
  selectTriggerSteps,
  type EventList,
  type Trigger,
  type TriggerList,
} from './scenario';
import type { TriggerPacket } from './scenario-runner';
import { clonePlain, freezeDeep, isRecord } from './plain-data';
import { validateScenario } from './validate';
import { isEffectId } from '../effects/catalogue';

/** Gesture adapters also accept plugin captures; only canonical packets can reach the runner. */
export function isTriggerPacket(value: unknown): value is TriggerPacket {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !['controlId', 'itemId', 'interactionId', 'sourceStateId'].every(
      (key) => typeof value[key] === 'string',
    )
  ) {
    return false;
  }
  if (typeof value.capturedAt !== 'number' || !Number.isFinite(value.capturedAt)) {
    return false;
  }
  if (value.trigger !== 'event' && !TRIGGERS.some((trigger) => trigger === value.trigger)) {
    return false;
  }
  if (value.effect !== undefined && !isEffectId(value.effect)) {
    return false;
  }
  if (
    value.origin !== undefined &&
    (!isRecord(value.origin) ||
      ![value.origin.x, value.origin.y].every(
        (axis) => typeof axis === 'number' && Number.isFinite(axis) && axis >= 0 && axis <= 1,
      ))
  ) {
    return false;
  }
  if (value.listenerId !== undefined && typeof value.listenerId !== 'string') {
    return false;
  }
  if (
    value.event !== undefined &&
    (!isRecord(value.event) ||
      typeof value.event.id !== 'string' ||
      (value.event.parameter !== undefined && typeof value.event.parameter !== 'string'))
  ) {
    return false;
  }
  if (
    value.eventAncestry !== undefined &&
    (!isRecord(value.eventAncestry) ||
      !Number.isSafeInteger(value.eventAncestry.depth) ||
      !Array.isArray(value.eventAncestry.listeners) ||
      !value.eventAncestry.listeners.every((id) => typeof id === 'string'))
  ) {
    return false;
  }
  return (
    Array.isArray(value.steps) &&
    validateScenario({ triggers: { press: { steps: value.steps } }, events: [] }).length === 0
  );
}

function packet({
  list,
  ...capture
}: Omit<TriggerPacket, 'steps'> & { list: TriggerList }): TriggerPacket {
  return freezeDeep({
    ...capture,
    ...(list.effect ? { effect: list.effect } : {}),
    steps: clonePlain(selectTriggerSteps(list, capture.sourceStateId) ?? []),
  });
}

export function captureTrigger(
  control: ControlConfig,
  itemId: string,
  trigger: Trigger,
  interactionId: string,
  sourceStateId: string,
  capturedAt = Date.now(),
): TriggerPacket | undefined {
  const list = control.scenario?.triggers[trigger];
  return list && !isEmptyList(list)
    ? packet({
        controlId: control.id,
        itemId,
        trigger,
        interactionId,
        sourceStateId,
        capturedAt,
        list,
      })
    : undefined;
}

export function captureEvent(
  control: ControlConfig,
  itemId: string,
  listener: EventList,
  interactionId: string,
  sourceStateId: string,
  capturedAt: number,
  parameter?: string,
  payload?: unknown,
  eventAncestry?: EventAncestry,
): TriggerPacket {
  return {
    ...packet({
      controlId: control.id,
      itemId,
      trigger: 'event',
      listenerId: listener.id,
      interactionId,
      sourceStateId,
      capturedAt,
      list: listener.list,
      event: clonePlain({ id: listener.eventId, parameter, payload }),
    }),
    ...(eventAncestry ? { eventAncestry: structuredClone(eventAncestry) } : {}),
  };
}

import type { EventAncestry } from '../plugins/contracts';
import type { ControlConfig } from '../controls/model';
import type { EventList, Trigger, TriggerList } from './scenario';
import type { TriggerPacket } from './scenario-runner';
import { clonePlain, freezeDeep } from './plain-data';

function packet(
  control: ControlConfig,
  itemId: string,
  trigger: Trigger | 'event',
  listenerId: string | undefined,
  interactionId: string,
  sourceStateId: string,
  capturedAt: number,
  list: TriggerList,
  event?: TriggerPacket['event'],
): TriggerPacket | undefined {
  const own = list.byState && Object.hasOwn(list.byState, sourceStateId);
  const steps = own ? list.byState![sourceStateId] : list.steps;
  return freezeDeep({
    controlId: control.id,
    itemId,
    trigger,
    ...(listenerId ? { listenerId } : {}),
    interactionId,
    sourceStateId,
    capturedAt,
    steps: clonePlain(steps),
    ...(event ? { event: clonePlain(event) } : {}),
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
  return list
    ? packet(control, itemId, trigger, undefined, interactionId, sourceStateId, capturedAt, list)
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
    ...packet(
      control,
      itemId,
      'event',
      listener.id,
      interactionId,
      sourceStateId,
      capturedAt,
      listener.list,
      { id: listener.eventId, parameter, payload },
    )!,
    ...(eventAncestry ? { eventAncestry: structuredClone(eventAncestry) } : {}),
  };
}

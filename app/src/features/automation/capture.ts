import type { EventAncestry } from '../plugins/contracts';
import type { ControlConfig } from '../controls/model';
import { selectTriggerSteps, type EventList, type Trigger, type TriggerList } from './scenario';
import type { TriggerPacket } from './scenario-runner';
import { clonePlain, freezeDeep } from './plain-data';

function packet({
  list,
  ...capture
}: Omit<TriggerPacket, 'steps'> & { list: TriggerList }): TriggerPacket {
  return freezeDeep({
    ...capture,
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
  return list
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

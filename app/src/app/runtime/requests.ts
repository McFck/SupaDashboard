// Owner side of the runtime protocol: validates requests from other windows before they touch the runtime.
import { get } from 'svelte/store';
import { settings } from '../../features/settings/state.svelte';
import { isRecord } from '../../features/automation/plain-data';
import { newId, TRIGGERS, type Trigger } from '../../features/automation/scenario';
import {
  VARIABLE_TYPES,
  type VariableType,
  type VariableValue,
} from '../../features/automation/variables';
import type { RuntimeSession } from './session.svelte';
import { validPageChangePayload, type RuntimeRequest } from './protocol';

const MAX_ITEM_ID = 128;
const MAX_EVENT_TEXT = 256;

type Payload = Record<string, unknown>;

function isVariableValue(value: unknown): value is VariableValue {
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

export async function handleRuntimeRequest(runtime: RuntimeSession, request: RuntimeRequest) {
  const payload = isRecord(request.payload) ? request.payload : {};
  const snapshot = () => get(runtime.snapshots);

  switch (request.type) {
    case 'snapshot':
      return snapshot();

    case 'changePage':
      changePage(runtime, request.payload);
      return snapshot();

    case 'simulate':
      return simulate(runtime, payload);

    case 'emitEvent':
      await emitEvent(runtime, payload);
      return snapshot();

    case 'stop':
      if (typeof payload.controlId !== 'string') {
        throw new Error('Invalid stop request');
      }
      await runtime.stopControl(payload.controlId);
      return { stopped: true };

    case 'setVariable':
      if (typeof payload.id !== 'string' || !isVariableValue(payload.value)) {
        throw new Error('Invalid variable request');
      }
      await runtime.setVariable(payload.id, payload.value);
      return snapshot();

    case 'createVariable':
      createVariable(runtime, payload);
      return snapshot();

    case 'renameVariable':
      if (typeof payload.id !== 'string' || typeof payload.name !== 'string') {
        throw new Error('Invalid variable request');
      }
      runtime.variables.rename(payload.id, payload.name);
      return snapshot();

    case 'setVariablePersistence':
      if (typeof payload.id !== 'string' || typeof payload.persistent !== 'boolean') {
        throw new Error('Invalid variable request');
      }
      runtime.variables.setPersistent(payload.id, payload.persistent);
      return snapshot();

    case 'deleteVariable':
      if (typeof payload.id !== 'string') {
        throw new Error('Invalid variable request');
      }
      runtime.variables.remove(payload.id);
      return snapshot();

    default:
      throw new Error('Unknown runtime request');
  }
}

function changePage(runtime: RuntimeSession, change: unknown) {
  if (!validPageChangePayload(change)) {
    throw new Error('Invalid page change request');
  }
  if (!('page' in change)) {
    runtime.changePageInDirection(change.direction, change.reason);
    return;
  }
  const pageId = change.page;
  if (!settings.deck.pages.some((page) => page.id === pageId)) {
    throw new Error('Page is unavailable');
  }
  runtime.changePage(pageId, change.reason);
}

function simulate(runtime: RuntimeSession, payload: Payload) {
  const { controlId, trigger = 'press', itemId = '' } = payload;
  const valid =
    typeof controlId === 'string' &&
    typeof itemId === 'string' &&
    itemId.length <= MAX_ITEM_ID &&
    TRIGGERS.includes(trigger as Trigger);
  if (!valid) {
    throw new Error('Invalid simulation request');
  }
  void runtime.dispatchTrigger(controlId, itemId, trigger as Trigger).catch(() => {});
  return { status: 'started' };
}

async function emitEvent(runtime: RuntimeSession, payload: Payload) {
  const { eventId, parameter } = payload;
  const validParameter =
    parameter === undefined ||
    (typeof parameter === 'string' && parameter.length <= MAX_EVENT_TEXT);
  if (typeof eventId !== 'string' || eventId.length > MAX_EVENT_TEXT || !validParameter) {
    throw new Error('Invalid event request');
  }
  await runtime.emitEvent(eventId, parameter);
}

function createVariable(runtime: RuntimeSession, payload: Payload) {
  const { name, type, initialValue } = payload;
  if (typeof name !== 'string' || !VARIABLE_TYPES.includes(type as VariableType)) {
    throw new Error('Invalid variable definition');
  }
  runtime.variables.createUser({
    id: `user:${newId()}`,
    name,
    type: type as VariableType,
    initialValue: initialValue as VariableValue,
  });
}

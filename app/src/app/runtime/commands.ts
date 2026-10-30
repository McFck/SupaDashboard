import { get } from 'svelte/store';
import { controlById } from '../../features/settings/state.svelte';
import { captureTrigger } from '../../features/automation/capture';
import type { RunResult, TriggerPacket } from '../../features/automation/scenario-runner';
import { newId, type Trigger } from '../../features/automation/scenario';
import type { PageChangePayload, RemotePageChangeReason } from './protocol';
import { runtimeView, type RuntimeSnapshot } from './state';
import { requestRuntime } from './client';
import { controlStateId, currentRuntime } from './session.svelte';

export async function requestPageChange(change: { page: string }, reason: RemotePageChangeReason) {
  const runtime = currentRuntime();
  if (runtime?.isOwner) return runtime.changePage(change.page, reason);
  const payload: PageChangePayload = { page: change.page, reason };
  const snapshot = (await requestRuntime({ type: 'changePage', payload })) as RuntimeSnapshot;
  return !!snapshot && snapshot.activePage === change.page;
}

export async function dispatchRuntimeTrigger(controlId: string, itemId: string, trigger: Trigger) {
  const runtime = currentRuntime();
  if (runtime) return runtime.dispatchTrigger(controlId, itemId, trigger);
  try {
    return (await requestRuntime({
      type: 'simulate',
      payload: { controlId, itemId, trigger },
    })) as RunResult | { status: 'started' };
  } catch {
    return { status: 'rejected' } as RunResult;
  }
}

/** Capture the active state's immutable trigger list at interaction start. */
export function captureRuntimeTrigger(
  controlId: string,
  itemId: string,
  trigger: Trigger,
  interactionId: string = newId(),
) {
  const control = controlById(controlId);
  if (!control) return undefined;
  const runtime = currentRuntime();
  const variables = runtime?.variables ?? get(runtimeView).variables;
  return captureTrigger(
    control,
    itemId,
    trigger,
    interactionId,
    controlStateId(control, variables),
  );
}

/** Run a packet already captured on pointerdown; only the local runtime owner can execute it. */
export function dispatchRuntimePacket(packet: TriggerPacket | undefined) {
  const runtime = currentRuntime();
  return packet && runtime
    ? runtime.dispatch(packet)
    : Promise.resolve({ status: packet ? 'rejected' : 'completed' } as RunResult);
}

export async function simulateRuntimeEvent(eventId: string, parameter?: string) {
  const runtime = currentRuntime();
  if (runtime) {
    await runtime.emitEvent(eventId, parameter);
    return true;
  }
  try {
    await requestRuntime({ type: 'emitEvent', payload: { eventId, parameter } });
    return true;
  } catch {
    return false;
  }
}

export async function stopRuntimeControl(controlId: string) {
  const runtime = currentRuntime();
  if (runtime) return runtime.execution.stopControl(controlId);
  return requestRuntime({ type: 'stop', payload: { controlId } });
}

function contentCommand(
  controlId: string,
  command: 'next' | 'prev' | 'goto' | 'reload',
  index?: number,
) {
  return currentRuntime()?.contentCommand(controlId, command, index);
}

function rememberVideoPosition(controlId: string, source: string, time: number) {
  currentRuntime()?.rememberVideoPosition(controlId, source, time);
}

function videoPosition(controlId: string, source: string) {
  return currentRuntime()?.videoPosition(controlId, source);
}

async function setAppletView(appletId: string, viewId: string) {
  const runtime = currentRuntime();
  return runtime?.isOwner ? runtime.applets.setView(appletId, viewId) : false;
}

export const runtimeCommands = {
  captureRuntimeTrigger,
  dispatchRuntimePacket,
  dispatchRuntimeTrigger,
  requestPageChange,
  simulateRuntimeEvent,
  stopRuntimeControl,
  requestRuntime,
  contentCommand,
  rememberVideoPosition,
  videoPosition,
  setAppletView,
};
export type RuntimeCommands = typeof runtimeCommands;

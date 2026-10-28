import { get } from 'svelte/store';
import { settings, controlById } from '../../features/settings/state.svelte';
import { effectiveVariant } from '../../features/controls/control-state';
import {
  captureTrigger,
  type RunResult,
  type TriggerPacket,
} from '../../features/automation/scenario-runner';
import type { Trigger } from '../../features/automation/scenario';
import type { PageChangePayload } from './sync';
import { runtimeView, type RuntimeSnapshot } from './state';
import { requestRuntime } from './client';
import { currentRuntime } from './lifecycle';

const scenarioId = () =>
  globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function requestPageChange(
  change: { direction: 'next' | 'prev' } | { page: string },
  reason: 'dot' | 'swipe' | 'skin',
) {
  const runtime = currentRuntime();
  if (runtime?.isOwner)
    return 'page' in change
      ? runtime.changePage(change.page, reason)
      : runtime.changePageInDirection(change.direction, reason);
  const payload: PageChangePayload =
    'page' in change ? { page: change.page, reason } : { direction: change.direction, reason };
  const snapshot = (await requestRuntime({ type: 'changePage', payload })) as RuntimeSnapshot;
  return (
    !!snapshot &&
    typeof snapshot.activePage === 'string' &&
    (!('page' in change) || snapshot.activePage === change.page)
  );
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
  interactionId: string = scenarioId(),
) {
  const control = controlById(controlId);
  if (!control) return undefined;
  const runtime = currentRuntime();
  const variables = runtime?.variables ?? get(runtimeView).variables;
  const stateId =
    runtime?.getState(controlId) ??
    effectiveVariant(control, variables, settings.variants[controlId] ?? 0).stateId;
  return captureTrigger(control, itemId, trigger, interactionId, stateId);
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
  if (runtime) return runtime.stopControl(controlId);
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

function updateSkinConfig(skinId: string, stored?: Record<string, unknown>) {
  return currentRuntime()?.updateSkinConfig(skinId, stored);
}

async function setSkinView(skinId: string, viewId: string) {
  const runtime = currentRuntime();
  return runtime?.isOwner ? runtime.setSkinView(skinId, viewId) : false;
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
  updateSkinConfig,
  setSkinView,
};
export type RuntimeCommands = typeof runtimeCommands;

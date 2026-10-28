// Starts and stops this window's side of the runtime: the dashboard owns it, the panel mirrors it.
import { get } from 'svelte/store';
import { isTauri } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { actions } from '../../features/plugins/registry';
import { settings } from '../../features/settings/state.svelte';
import type { ScenarioFailure } from '../../features/automation/scenario-runner';
import type { Trigger } from '../../features/automation/scenario';
import { acceptRuntimeSnapshot, attachRuntimeConnection, setRuntimeSync } from './client';
import { bootRuntime, stopRuntime } from './lifecycle';
import { handleRuntimeRequest } from './requests';
import { runtimeView } from './state';
import { browserRuntimeLease, openRuntimeSync, type RuntimeSync } from './sync';

export type WindowView = 'dashboard' | 'panel';

let sync: RuntimeSync | undefined;
let releaseClient: (() => void) | undefined;
let stopLease: (() => Promise<void>) | undefined;
let disposeOwner: (() => Promise<void>) | undefined;
let stopping: Promise<void> | undefined;
let stopped = false;

function controlName(controlId: string) {
  return settings.controls.find((item) => item.id === controlId)?.name ?? 'Automation';
}

function reportFailure(failure: ScenarioFailure) {
  if (failure.kind === 'cycle') {
    toast.error(`${controlName(failure.controlId)}: Event cycle detected`);
    return;
  }
  const action = failure.actionId
    ? (actions.get(failure.actionId)?.title ?? failure.actionId)
    : undefined;
  const step = action ?? (failure.kind === 'delay' ? 'Wait' : 'Condition');
  toast.error(`${controlName(failure.controlId)}: ${step} failed`);
}

function reportQueueFull(controlId: string, trigger: Trigger | 'event') {
  toast.warning(`${controlName(controlId)} · ${trigger} queue is full`);
}

/** Boots the runtime as owner and serves other windows' requests; resolves to its teardown. */
async function startOwner(channel: RuntimeSync) {
  if (stopped) {
    return async () => {};
  }
  const { runtime, dispose } = await bootRuntime({
    owner: true,
    onFailure: reportFailure,
    onQueueFull: reportQueueFull,
  });
  if (stopped) {
    await dispose();
    return async () => {};
  }

  channel.becomeOwner((request) => handleRuntimeRequest(runtime, request));
  const unsubscribe = runtime.snapshots.subscribe((snapshot) => channel.publish(snapshot));
  return async () => {
    unsubscribe();
    channel.releaseOwnership();
    await dispose();
  };
}

export async function startRuntimeServices(view: WindowView) {
  const native = isTauri();
  const sourceId = native ? (view === 'panel' ? 'panel' : 'main') : undefined;
  const channel = await openRuntimeSync(sourceId, {
    onSnapshot: acceptRuntimeSnapshot,
    onAvailability: (online) => {
      if (!online) {
        runtimeView.set({ ...get(runtimeView), online: false });
      }
    },
  });
  if (stopped) {
    channel.close();
    return;
  }
  sync = channel;

  if (view === 'panel') {
    void attachRuntimeConnection(channel)
      .then((disconnect) => {
        if (stopped) {
          disconnect();
        } else {
          releaseClient = disconnect;
        }
      })
      .catch(() => {});
    return;
  }

  releaseClient = setRuntimeSync(channel);
  if (native) {
    disposeOwner = await startOwner(channel);
    return;
  }
  // Several browser tabs share one localStorage: only the lease holder owns the runtime.
  const lease = browserRuntimeLease(
    async () => {
      disposeOwner = await startOwner(channel);
    },
    async () => {
      await disposeOwner?.();
      disposeOwner = undefined;
    },
  );
  stopLease = lease.stop;
}

export function stopRuntimeServices() {
  stopped = true;
  stopping ??= (async () => {
    try {
      await stopLease?.();
      await disposeOwner?.();
    } finally {
      disposeOwner = undefined;
      try {
        await stopRuntime();
      } finally {
        releaseClient?.();
        releaseClient = undefined;
        sync?.close();
        sync = undefined;
      }
    }
  })();
  return stopping;
}

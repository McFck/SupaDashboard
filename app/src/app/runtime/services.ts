// Starts and stops this window's side of the runtime: the dashboard owns it, the panel mirrors it.
import { get } from 'svelte/store';
import { isTauri } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { actions } from '../../features/plugins/registry';
import { settings } from '../../features/settings/state.svelte';
import type { ScenarioFailure } from '../../features/automation/scenario-runner';
import type { Trigger } from '../../features/automation/scenario';
import { acceptRuntimeSnapshot, attachRuntimeConnection, setRuntimeSync } from './client';
import { RuntimeSession } from './session.svelte';
import { loadVariableState } from './variable-persistence';
import { handleRuntimeRequest } from './requests';
import { runtimeView } from './state';
import { browserRuntimeLease } from './lease';
import { openRuntimeSync, type RuntimeSync } from './transport';

export type WindowView = 'dashboard' | 'panel';

let sync: RuntimeSync | undefined;
let releaseClient: (() => void) | undefined;
let stopLease: (() => Promise<void>) | undefined;
let stopOwner: (() => Promise<void>) | undefined;
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
  toast.warning(`${controlName(controlId)}: ${trigger} queue is full`);
}

/** Creates the owner session, serves other windows' requests and publishes its snapshots. */
async function startOwner(channel: RuntimeSync) {
  const loaded = await loadVariableState();
  if (stopped) {
    return;
  }
  const session = new RuntimeSession({
    ...loaded,
    onFailure: reportFailure,
    onQueueFull: reportQueueFull,
  });
  channel.becomeOwner((request) => handleRuntimeRequest(session, request));
  const unsubscribe = session.snapshots.subscribe((snapshot) => {
    runtimeView.set(snapshot);
    channel.publish(snapshot);
  });
  let disposal: Promise<void> | undefined;
  // The browser lease and the window teardown both stop the owner; they share one disposal.
  stopOwner = () =>
    (disposal ??= (async () => {
      unsubscribe();
      channel.releaseOwnership();
      await session.dispose();
    })());
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
    await startOwner(channel);
    return;
  }
  // Several browser tabs share one localStorage: only the lease holder owns the runtime. The lease
  // stays held until the owner has stopped, so the next tab never loads variables mid-save.
  const lease = browserRuntimeLease(
    () => startOwner(channel),
    async () => {
      await stopOwner?.();
    },
  );
  stopLease = lease.stop;
}

export async function stopRuntimeServices() {
  stopped = true;
  try {
    await stopLease?.();
    await stopOwner?.();
  } finally {
    releaseClient?.();
    releaseClient = undefined;
    sync?.close();
    sync = undefined;
  }
}

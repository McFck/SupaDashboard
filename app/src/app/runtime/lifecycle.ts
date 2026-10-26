import { RuntimeSession, type RuntimeOptions } from './session.svelte';
import { runtimeView } from './state';
import { loadVariableState } from './variable-persistence';

export type RuntimeHandle = { runtime: RuntimeSession; dispose(): Promise<void> };

let active: RuntimeHandle | undefined;
let pendingBoot: Promise<RuntimeHandle> | undefined;
let stopping: Promise<void> | undefined;
let stopRequested = false;

export function bootRuntime(options: RuntimeOptions = {}): Promise<RuntimeHandle> {
  if (stopping) {
    return stopping.then(() => bootRuntime(options));
  }
  if (active) {
    return Promise.resolve(active);
  }
  if (pendingBoot) {
    return pendingBoot;
  }
  stopRequested = false;
  pendingBoot = Promise.resolve()
    .then(async () => {
      const loaded = options.variables
        ? { variables: options.variables, persistence: options.persistence }
        : await loadVariableState();
      if (stopRequested) {
        throw new Error('Runtime startup was cancelled');
      }
      const runtime = new RuntimeSession({ ...options, ...loaded });
      let unsubscribeView: () => void;
      try {
        if (stopRequested) {
          throw new Error('Runtime startup was cancelled');
        }
        unsubscribeView = runtime.snapshots.subscribe((snapshot) => runtimeView.set(snapshot));
      } catch (error) {
        await runtime.dispose();
        throw error;
      }
      let disposal: Promise<void> | undefined;
      const dispose = () => {
        if (!disposal) {
          disposal = Promise.resolve()
            .then(() => runtime.dispose())
            .finally(() => {
              try {
                unsubscribeView();
              } finally {
                if (active?.runtime === runtime) {
                  active = undefined;
                }
              }
            });
          if (!stopping) {
            stopping = disposal.finally(() => {
              stopping = undefined;
            });
            disposal = stopping;
          }
        }
        return disposal;
      };
      active = { runtime, dispose };
      return active;
    })
    .finally(() => {
      pendingBoot = undefined;
    });
  return pendingBoot;
}

export function currentRuntime() {
  return stopping ? undefined : active?.runtime;
}

export function stopRuntime(): Promise<void> {
  if (stopping) {
    return stopping;
  }
  stopRequested = true;
  const boot = pendingBoot;
  stopping = Promise.resolve()
    .then(async () => {
      // Startup failure or cancellation leaves no active session to dispose.
      await boot?.catch(() => {});
      await active?.dispose();
    })
    .finally(() => {
      stopping = undefined;
    });
  return stopping;
}

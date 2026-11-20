// Shared by the bundled plugins that mirror a native service: only the dashboard owner follows it and runs its actions.
import { currentRuntime } from '../app/runtime/session.svelte';
import { runtimeView } from '../app/runtime/state';
import type { ActionContext } from '../features/plugins/contracts';
import { ownSetupCleanup } from '../features/plugins/setup-scope';

/** Runs `start` while this window owns the dashboard, and its returned stop when ownership ends. Returns the dispose. */
export function whileOwner(start: () => () => void) {
  let stop: (() => void) | undefined;
  let stopped = false;
  const stopRuntime = runtimeView.subscribe(() => {
    if (stopped) {
      return;
    }
    if (currentRuntime()?.isOwner) {
      // Assign before starting: a synchronous variable update publishes another runtime snapshot.
      if (!stop) {
        stop = () => {};
        stop = start();
      }
    } else {
      stop?.();
      stop = undefined;
    }
  });
  const dispose = () => {
    stopped = true;
    stopRuntime();
    stop?.();
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose, { once: true });
  ownSetupCleanup(dispose);
  return dispose;
}

/** An action body that only the dashboard owner runs. */
export const ownerAction =
  (plugin: string, run: (args: Record<string, unknown>) => Promise<unknown>) =>
  async (args: Record<string, unknown>, context?: ActionContext) => {
    if (context?.signal.aborted) {
      return;
    }
    if (!currentRuntime()?.isOwner) {
      throw new Error(`${plugin} runtime is unavailable`);
    }
    await run(args);
  };

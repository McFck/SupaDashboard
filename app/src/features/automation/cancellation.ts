// Waiting that ends early, with RunCancelled, when a run's abort signal fires.

export class RunCancelled extends Error {}

export function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new RunCancelled());
      return;
    }
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new RunCancelled());
    };
    function cleanup() {
      signal.removeEventListener('abort', abort);
    }
    function done() {
      cleanup();
      resolve();
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function nextTask(signal: AbortSignal) {
  return wait(0, signal);
}

/** Stop awaiting an ignored-signal action after cancellation while observing its eventual rejection. */
export function awaitAction<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new RunCancelled());
    };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

export function ensureActive(signal: AbortSignal) {
  if (signal.aborted) {
    throw new RunCancelled();
  }
}

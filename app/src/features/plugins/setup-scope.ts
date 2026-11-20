let current: Set<() => void> | undefined;

/** Captures disposers from API 2 helpers whose existing callers ignore their return value. */
export function inPluginSetup(cleanups: Set<() => void>, setup: () => void) {
  const previous = current;
  current = cleanups;
  try {
    setup();
  } finally {
    current = previous;
  }
}

export function ownSetupCleanup(cleanup: () => void) {
  current?.add(cleanup);
}

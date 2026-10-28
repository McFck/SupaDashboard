/** A single browser dashboard tab holds this Web Lock while it owns automation and persistence. */
export function browserRuntimeLease(
  onAcquire: () => Promise<void>,
  onRelease: () => Promise<void>,
) {
  let stopped = false,
    release: (() => void) | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  const locks = navigator.locks;
  if (!locks)
    return {
      stop: async () => {
        stopped = true;
      },
    };
  const attempt = () => {
    if (stopped) return;
    void locks
      .request(
        'supadashboard-runtime-v1',
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) {
            timer = setTimeout(attempt, 1000);
            return;
          }
          await onAcquire();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          release = undefined;
          await onRelease();
          if (!stopped) timer = setTimeout(attempt, 0);
        },
      )
      .catch(() => {
        if (!stopped) timer = setTimeout(attempt, 1000);
      });
  };
  attempt();
  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      release?.();
      await Promise.resolve();
    },
  };
}

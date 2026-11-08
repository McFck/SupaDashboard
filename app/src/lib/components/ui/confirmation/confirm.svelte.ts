export type ConfirmOptions = {
  title: string;
  action: string;
  destructive?: boolean;
  cancel?: false;
};

type Request = ConfirmOptions & {
  id: number;
  invoker: HTMLElement | null;
  settled: boolean;
  resolve: (value: boolean) => void;
};

export const confirmationState = $state<{ current: Request | null; queue: Request[] }>({ current: null, queue: [] });
let nextId = 0;

export function confirm(options: ConfirmOptions): Promise<boolean> {
  const invoker = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return new Promise(resolve => {
    const request: Request = { ...options, id: ++nextId, invoker, settled: false, resolve };
    if (confirmationState.current) confirmationState.queue.push(request);
    else confirmationState.current = request;
  });
}

export function settleConfirmation(id: number, result: boolean) {
  const request = confirmationState.current;
  if (!request || request.id !== id || request.settled) return false;
  request.settled = true;
  request.resolve(result);
  return true;
}

export function completeConfirmation(id: number) {
  const request = confirmationState.current;
  if (!request || request.id !== id || !request.settled) return false;
  confirmationState.current = confirmationState.queue.shift() ?? null;
  return true;
}

export function disposeConfirmations() {
  const requests = [confirmationState.current, ...confirmationState.queue].filter((request): request is Request => request !== null);
  confirmationState.current = null;
  confirmationState.queue = [];
  for (const request of requests) {
    if (request.settled) continue;
    request.settled = true;
    request.resolve(false);
  }
}

// The messages windows exchange about the runtime, and their validation at the receiving end.

export type PageChangeReason = 'dot' | 'swipe' | 'skin';
export type PageChangePayload =
  | { direction: 'next' | 'prev'; reason: PageChangeReason }
  | { page: string; reason: PageChangeReason };
export type RuntimeRequest =
  | { type: 'changePage'; payload: PageChangePayload }
  | {
      type:
        | 'snapshot'
        | 'simulate'
        | 'emitEvent'
        | 'setVariable'
        | 'createVariable'
        | 'renameVariable'
        | 'setVariablePersistence'
        | 'deleteVariable'
        | 'stop';
      payload?: unknown;
    };
export type SyncMessage =
  | {
      kind: 'request';
      sourceId: string;
      requestId: string;
      revision: number;
      request: RuntimeRequest;
    }
  | {
      kind: 'reply';
      sourceId: string;
      destination: string;
      requestId: string;
      revision: number;
      ok: boolean;
      value?: unknown;
      error?: string;
    }
  | { kind: 'snapshot'; sourceId: string; destination?: string; revision: number; value: unknown };

const MAX_MESSAGE_SIZE = 256 * 1024;
export const REQUEST_TYPES = new Set([
  'snapshot',
  'simulate',
  'emitEvent',
  'setVariable',
  'createVariable',
  'renameVariable',
  'setVariablePersistence',
  'deleteVariable',
  'stop',
  'changePage',
]);

export function validPageChangePayload(value: unknown): value is PageChangePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (payload.reason !== 'dot' && payload.reason !== 'swipe' && payload.reason !== 'skin')
    return false;
  if (typeof payload.page === 'string')
    return (
      Object.keys(payload).sort().join(',') === 'page,reason' &&
      payload.page.length > 0 &&
      payload.page.length <= 128
    );
  return (
    Object.keys(payload).sort().join(',') === 'direction,reason' &&
    (payload.direction === 'next' || payload.direction === 'prev')
  );
}

export function validMessage(value: unknown): value is SyncMessage {
  if (!value || typeof value !== 'object') return false;
  let size: number;
  try {
    size = JSON.stringify(value).length;
  } catch {
    return false;
  }
  if (size > MAX_MESSAGE_SIZE) return false;
  const message = value as Record<string, any>;
  if (
    typeof message.sourceId !== 'string' ||
    message.sourceId.length > 128 ||
    !Number.isSafeInteger(message.revision) ||
    message.revision < 0
  )
    return false;
  if (message.kind === 'request')
    return (
      typeof message.requestId === 'string' &&
      message.requestId.length <= 128 &&
      message.request &&
      REQUEST_TYPES.has(message.request.type) &&
      (message.request.type !== 'changePage' || validPageChangePayload(message.request.payload))
    );
  if (message.kind === 'reply')
    return (
      typeof message.destination === 'string' &&
      typeof message.requestId === 'string' &&
      message.requestId.length <= 128 &&
      typeof message.ok === 'boolean' &&
      (message.error === undefined || typeof message.error === 'string')
    );
  if (message.kind === 'snapshot')
    return message.destination === undefined || typeof message.destination === 'string';
  return false;
}

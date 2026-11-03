// The messages windows exchange about the runtime, and their validation at the receiving end.
import { isRecord } from '../../features/automation/plain-data';
import type { PageChangeReason } from '../../features/layout/page-controller';
import { readStatus } from '../../features/media/now-playing-read';
import type { RuntimeSnapshot } from './state';
import { validTileEffects } from '../../features/effects/effect-runtime';

const REQUEST_TYPES = [
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
] as const;
/** Page changes another window may ask the owner for; actions and reconciliation stay in the owner. */
const REMOTE_PAGE_REASONS = ['dot', 'swipe'] as const satisfies readonly PageChangeReason[];
const MAX_MESSAGE_SIZE = 256 * 1024;
const MAX_ID_LENGTH = 128;

export type RemotePageChangeReason = (typeof REMOTE_PAGE_REASONS)[number];
export type PageChangePayload = { page: string; reason: RemotePageChangeReason };
export type RuntimeRequest =
  | { type: 'changePage'; payload: PageChangePayload }
  | { type: Exclude<(typeof REQUEST_TYPES)[number], 'changePage'>; payload?: unknown };
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

export function validPageChangePayload(value: unknown): value is PageChangePayload {
  if (!isRecord(value)) {
    return false;
  }
  if (!(REMOTE_PAGE_REASONS as readonly unknown[]).includes(value.reason)) {
    return false;
  }
  return (
    Object.keys(value).sort().join(',') === 'page,reason' &&
    typeof value.page === 'string' &&
    value.page.length > 0 &&
    value.page.length <= MAX_ID_LENGTH
  );
}

function validRequest(request: unknown) {
  return (
    isRecord(request) &&
    (REQUEST_TYPES as readonly unknown[]).includes(request.type) &&
    (request.type !== 'changePage' || validPageChangePayload(request.payload))
  );
}

function serializedSize(value: unknown) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Infinity;
  }
}

export function validMessage(value: unknown): value is SyncMessage {
  if (!isRecord(value) || serializedSize(value) > MAX_MESSAGE_SIZE) {
    return false;
  }
  const { kind, sourceId, revision, requestId } = value;
  if (
    typeof sourceId !== 'string' ||
    sourceId.length > MAX_ID_LENGTH ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  ) {
    return false;
  }
  const validRequestId = typeof requestId === 'string' && requestId.length <= MAX_ID_LENGTH;
  if (kind === 'request') {
    return validRequestId && validRequest(value.request);
  }
  if (kind === 'reply') {
    return (
      validRequestId &&
      typeof value.destination === 'string' &&
      typeof value.ok === 'boolean' &&
      (value.error === undefined || typeof value.error === 'string')
    );
  }
  if (kind === 'snapshot') {
    return value.destination === undefined || typeof value.destination === 'string';
  }
  return false;
}

/** The parts of an owner snapshot a mirror window relies on. */
export function validSnapshot(value: unknown): value is RuntimeSnapshot {
  return (
    isRecord(value) &&
    typeof value.activePage === 'string' &&
    isRecord(value.variables) &&
    isRecord(value.busy) &&
    (value.effects === undefined || validTileEffects(value.effects)) &&
    readStatus(value.status) !== null
  );
}

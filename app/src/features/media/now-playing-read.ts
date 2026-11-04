// Validation of now-playing data where it crosses a boundary: plugin emissions and mirrored snapshots.
import { isRecord } from '../automation/plain-data';
import type {
  NowPlayingSession,
  NowPlayingSourceState,
  NowPlayingTimeline,
} from '../plugins/contracts';
import {
  EMPTY_STATUS,
  MAX_ID_LENGTH,
  markNative,
  nativeIdentity,
  type Candidate,
  type NativeIdentity,
  type StatusSnapshot,
  type WidgetStatus,
} from './now-playing';

export const MAX_SESSIONS = 16;
export const MAX_CATALOGUE = 64;
const MAX_TEXT_LENGTH = 512;
const MAX_URL_LENGTH = 2048;
const STATES = ['playing', 'paused', 'stopped', 'unknown'];
const HANDLE = /^[\w-]{1,128}$/;

const id = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
const text = (value: unknown) =>
  typeof value === 'string' ? value.slice(0, MAX_TEXT_LENGTH) : undefined;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function readTimeline(value: unknown): NowPlayingTimeline | undefined {
  if (
    !isRecord(value) ||
    !finite(value.positionMs) ||
    !finite(value.startMs) ||
    !finite(value.endMs) ||
    !finite(value.sampledAtMs) ||
    value.endMs < value.startMs
  ) {
    return undefined;
  }
  const { positionMs, startMs, endMs, sampledAtMs } = value;
  return {
    positionMs,
    startMs,
    endMs,
    sampledAtMs,
    ...(finite(value.rate) ? { rate: value.rate } : {}),
  };
}

/** Bad timing or art only costs that detail; a session without usable text or identity is dropped. */
function readSession(value: unknown): NowPlayingSession | null {
  if (!isRecord(value) || !id(value.sessionId) || !STATES.includes(value.state)) {
    return null;
  }
  const title = text(value.title);
  const artist = text(value.artist);
  const album = text(value.album);
  if (title === undefined || artist === undefined || album === undefined) {
    return null;
  }
  const timeline = readTimeline(value.timeline);
  if (
    (value.shuffle != null && typeof value.shuffle !== 'boolean') ||
    (value.repeat != null &&
      value.repeat !== 'off' &&
      value.repeat !== 'context' &&
      value.repeat !== 'track')
  ) {
    return null;
  }
  return {
    sessionId: value.sessionId,
    ...(id(value.trackId) ? { trackId: value.trackId } : {}),
    title,
    artist,
    album,
    state: value.state,
    current: value.current === true,
    ...(timeline ? { timeline } : {}),
    ...(typeof value.shuffle === 'boolean' ? { shuffle: value.shuffle } : {}),
    ...(value.repeat === 'off' || value.repeat === 'context' || value.repeat === 'track'
      ? { repeat: value.repeat }
      : {}),
    ...(typeof value.artwork === 'string' && HANDLE.test(value.artwork)
      ? { artwork: value.artwork }
      : {}),
  };
}

/**
 * A provider's emission. Anything malformed rejects the whole state, so one bad payload cannot
 * show half a list. Native marks survive only on the adapter's own objects.
 */
export function readSourceState(value: unknown): NowPlayingSourceState | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.state === 'unavailable') {
    return { state: 'unavailable' };
  }
  if (
    value.state !== 'ready' ||
    !Array.isArray(value.sessions) ||
    value.sessions.length > MAX_SESSIONS
  ) {
    return null;
  }
  const sessions: NowPlayingSession[] = [];
  const seen = new Set<string>();
  for (const raw of value.sessions) {
    const session = readSession(raw);
    if (!session || seen.has(session.sessionId)) {
      return null;
    }
    seen.add(session.sessionId);
    const identity = isRecord(raw) ? nativeIdentity(raw) : undefined;
    sessions.push(identity ? markNative(session, identity) : session);
  }
  return { state: 'ready', sessions };
}

function readNative(value: unknown): NativeIdentity | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return isRecord(value) && id(value.id) && id(value.appId)
    ? { id: value.id, appId: value.appId }
    : null;
}

/** The art URL is one the owner built from a native handle; nothing else may reach an <img>. */
function assetUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'asset:' || url.hostname === 'asset.localhost';
  } catch {
    return false;
  }
}

function readWidget(value: unknown): WidgetStatus | null {
  if (!isRecord(value) || typeof value.unavailable !== 'boolean') {
    return null;
  }
  if (value.candidate === undefined) {
    return { unavailable: value.unavailable };
  }
  const candidate = value.candidate;
  const session = isRecord(candidate) ? readSession(candidate.session) : null;
  const native = isRecord(candidate) ? readNative(candidate.native) : null;
  if (!isRecord(candidate) || !id(candidate.provider) || !session || native === null) {
    return null;
  }
  if (value.artworkUrl !== undefined && !assetUrl(value.artworkUrl)) {
    return null;
  }
  const entry: Candidate = { provider: candidate.provider, session, ...(native ? { native } : {}) };
  return {
    candidate: entry,
    unavailable: value.unavailable,
    ...(value.artworkUrl === undefined ? {} : { artworkUrl: value.artworkUrl }),
  };
}

/** A mirrored `status`: absent (older owner) reads as empty, malformed as null. */
export function readStatus(value: unknown): StatusSnapshot | null {
  if (value === undefined) {
    return EMPTY_STATUS;
  }
  if (!isRecord(value) || !Array.isArray(value.catalogue) || !isRecord(value.widgets)) {
    return null;
  }
  if (
    value.catalogue.length > MAX_CATALOGUE ||
    !value.catalogue.every((entry) => isRecord(entry) && id(entry.key) && id(entry.title))
  ) {
    return null;
  }
  const widgets: Record<string, WidgetStatus> = {};
  for (const [controlId, raw] of Object.entries(value.widgets)) {
    const widget = readWidget(raw);
    if (!widget || controlId.length > MAX_ID_LENGTH) {
      return null;
    }
    widgets[controlId] = widget;
  }
  return {
    catalogue: value.catalogue.map(({ key, title }) => ({ key, title })),
    widgets,
  };
}

// Now-playing model: filter keys, the options reader and the rule that picks one session per widget.
import { isRecord } from '../automation/plain-data';
import type { NowPlayingSession } from '../plugins/contracts';

export const MAX_FILTERS = 32;
export const MAX_ID_LENGTH = 1024;
const APP_PREFIX = 'app:';
/** appOwners entries: a process name such as "spotify", not an app model id. */
export const KNOWN_APP_PREFIX = 'known-app:';

/** Identity the native adapter vouches for; a plugin cannot assert it (see `markNative`). */
export type NativeIdentity = { id: string; appId: string };

/** One session as seen by a widget, with the provider that reported it. */
export type Candidate = { provider: string; session: NowPlayingSession; native?: NativeIdentity };

export type CatalogueEntry = { key: string; title: string };
/** `artworkUrl` is the granted asset URL of the candidate's cover, once the owner has resolved it. */
export type WidgetStatus = { candidate?: Candidate; artworkUrl?: string; unavailable: boolean };
/** What the owner publishes: live apps for the editor and, per widget, what it shows now. */
export type StatusSnapshot = {
  catalogue: readonly CatalogueEntry[];
  widgets: Readonly<Record<string, WidgetStatus>>;
};
export const EMPTY_STATUS: StatusSnapshot = { catalogue: [], widgets: {} };

const nativeIdentities = new WeakMap<object, NativeIdentity>();

/** Only the native adapter calls this. Copies lose the mark, so forged objects never carry it. */
export function markNative<T extends object>(session: T, identity: NativeIdentity) {
  nativeIdentities.set(session, identity);
  return session;
}

export function nativeIdentity(session: object) {
  return nativeIdentities.get(session);
}

export const candidateKey = (candidate: Candidate) =>
  `${candidate.provider}\u0000${candidate.session.sessionId}`;

export const nativeAppKey = (appId: string) => APP_PREFIX + encodeURIComponent(appId);

/**
 * The persisted `sources` filter: empty means every source. Returns null for malformed data so
 * a damaged filter shows nothing instead of widening to everything.
 */
export function readNowPlayingOptions(options: unknown): string[] | null {
  const sources = isRecord(options) ? options.sources : undefined;
  if (sources === undefined) {
    return [];
  }
  if (
    !Array.isArray(sources) ||
    sources.length > MAX_FILTERS ||
    !sources.every((key) => typeof key === 'string' && key.length > 0 && key.length < MAX_ID_LENGTH)
  ) {
    return null;
  }
  return [...new Set<string>(sources)];
}

function knownAppMatches(key: string, appId: string) {
  try {
    return appId
      .toLowerCase()
      .includes(decodeURIComponent(key.slice(KNOWN_APP_PREFIX.length)).toLowerCase());
  } catch {
    return false;
  }
}

function matches(key: string, candidate: Candidate) {
  if (key === candidate.provider) {
    return true;
  }
  const native = candidate.native;
  if (!native) {
    return false;
  }
  if (key === 'system') {
    return true;
  }
  if (key.startsWith(APP_PREFIX)) {
    return key === nativeAppKey(native.appId);
  }
  return key.startsWith(KNOWN_APP_PREFIX) && knownAppMatches(key, native.appId);
}

/** The providers that can supply sessions for a filter; the native keys are all served by `system`. */
export function providersFor(filter: readonly string[], registered: Iterable<string>) {
  const all = [...registered];
  if (!filter.length) {
    return all;
  }
  const wanted = filter.map((key) =>
    key.startsWith(APP_PREFIX) || key.startsWith(KNOWN_APP_PREFIX) ? 'system' : key,
  );
  return all.filter((id) => wanted.includes(id));
}

/** A session reported by several providers (System and Spotify) counts once, named provider first. */
function withoutDuplicates(candidates: readonly Candidate[]) {
  const named = [...candidates].sort(
    (a, b) => Number(a.provider === 'system') - Number(b.provider === 'system'),
  );
  const seen = new Set<string>();
  return named.filter((candidate) => {
    const id = candidate.native?.id;
    if (id === undefined) {
      return true;
    }
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

/**
 * Picks the session a widget shows: only sources the filter allows; playing before not playing;
 * within a rank the previous pick stays, then the one Windows calls current, then a stable order.
 */
export function selectSession(
  candidates: readonly Candidate[],
  filter: readonly string[],
  previousKey?: string,
) {
  const allowed = candidates.filter(
    (candidate) => !filter.length || filter.some((key) => matches(key, candidate)),
  );
  const rank = (candidate: Candidate) => [
    candidate.session.state === 'playing' ? 0 : 1,
    candidateKey(candidate) === previousKey ? 0 : 1,
    candidate.session.current ? 0 : 1,
  ];
  return withoutDuplicates(allowed)
    .map((candidate) => ({ candidate, rank: rank(candidate), key: candidateKey(candidate) }))
    .sort(
      (a, b) =>
        a.rank[0] - b.rank[0] ||
        a.rank[1] - b.rank[1] ||
        a.rank[2] - b.rank[2] ||
        a.key.localeCompare(b.key),
    )[0]?.candidate;
}

/** "Spotify.exe" -> "Spotify"; model ids such as "Brand.App!Main" keep the app part. */
function appTitle(appId: string) {
  const name = appId.split('!')[0].replace(/\.exe$/i, '');
  return name.split('.').pop() || appId;
}

/** Apps with a live native session, in a stable order, for the editor's source list. */
export function liveApps(candidates: readonly Candidate[]): CatalogueEntry[] {
  const apps = new Map<string, CatalogueEntry>();
  for (const { native } of candidates) {
    if (native) {
      const key = nativeAppKey(native.appId);
      apps.set(key, { key, title: appTitle(native.appId) });
    }
  }
  return [...apps.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// Owner side of now-playing: runs each needed status source once, picks a session per widget and
// builds the snapshot the panel mirrors.
import type { ControlConfig } from '../controls/model';
import type { NowPlayingSourceState, StatusSourceDef } from '../plugins/contracts';
import {
  EMPTY_STATUS,
  candidateKey,
  liveApps,
  nativeIdentity,
  providersFor,
  readNowPlayingOptions,
  selectSession,
  type Candidate,
  type StatusSnapshot,
  type WidgetStatus,
} from './now-playing';
import { MAX_CATALOGUE, readSourceState } from './now-playing-read';

/** Well below the runtime's 256 KiB message ceiling, which would drop every snapshot, not just ours. */
const MAX_STATUS_BYTES = 128 * 1024;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** The provider every widget can show; it also lists the apps the editor offers. */
const SYSTEM = 'system';

type Host = {
  sources: ReadonlyMap<string, StatusSourceDef>;
  onChange(): void;
  /** Granted asset URL for a native cover handle, or null when it is gone. */
  resolveArtwork(handle: string): Promise<string | null>;
};

type Running = {
  generation: number;
  abort: AbortController;
  stop?: () => void;
  state?: NowPlayingSourceState;
  /** Logged once per failure, not once per bad emission. */
  failed: boolean;
};

export class StatusController {
  private readonly running = new Map<string, Running>();
  private readonly failures = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly filters = new Map<string, string[] | null>();
  private picked = new Map<string, string>();
  private readonly art = new Map<string, string | null>();
  private view: StatusSnapshot = EMPTY_STATUS;
  private signature = JSON.stringify(EMPTY_STATUS);
  private generation = 0;
  private disposed = false;
  private oversized = false;

  constructor(private readonly host: Host) {}

  snapshot() {
    return this.view;
  }

  /** What a transport action for this widget addresses now: the linked media source and exact session. */
  target(controlId: string) {
    const candidate = this.view.widgets[controlId]?.candidate;
    if (!candidate) {
      return undefined;
    }
    return {
      sourceId: this.host.sources.get(candidate.provider)?.mediaSourceId,
      sessionId: candidate.session.sessionId,
    };
  }

  /** Starts and stops providers to match the placed widgets; sources are shared, not per widget. */
  reconcile(controls: readonly ControlConfig[], placed: ReadonlySet<string>) {
    if (this.disposed) {
      return;
    }
    this.filters.clear();
    for (const control of controls) {
      if (control.type === 'nowPlaying' && placed.has(control.id)) {
        this.filters.set(control.id, readNowPlayingOptions(control.options));
      }
    }
    const demand = new Set<string>();
    if (this.filters.size && this.host.sources.has(SYSTEM)) {
      demand.add(SYSTEM);
    }
    for (const filter of this.filters.values()) {
      for (const id of filter ? providersFor(filter, this.host.sources.keys()) : []) {
        demand.add(id);
      }
    }
    for (const id of [...this.running.keys()]) {
      if (!demand.has(id)) {
        this.stopProvider(id);
      }
    }
    for (const id of demand) {
      if (!this.running.has(id)) {
        this.startProvider(id);
      }
    }
    this.recompute();
  }

  dispose() {
    this.disposed = true;
    for (const id of [...this.running.keys()]) {
      this.stopProvider(id);
    }
    this.filters.clear();
    this.picked.clear();
    this.art.clear();
    this.view = EMPTY_STATUS;
  }

  private startProvider(id: string) {
    const definition = this.host.sources.get(id);
    if (!definition) {
      return;
    }
    const entry: Running = {
      generation: ++this.generation,
      abort: new AbortController(),
      failed: false,
    };
    this.running.set(id, entry);
    try {
      entry.stop = definition.subscribe((raw) => this.receive(id, entry, raw), entry.abort.signal);
    } catch (error) {
      this.fail(id, entry, error);
      this.scheduleRetry(id, entry);
    }
  }

  private stopProvider(id: string) {
    const entry = this.running.get(id);
    this.running.delete(id);
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    if (!entry) {
      return;
    }
    entry.abort.abort();
    try {
      entry.stop?.();
    } catch (error) {
      console.error(`Status source "${id}" failed to stop`, error);
    }
  }

  /** A failing source is isolated: the others keep running and this one retries with a capped delay. */
  private scheduleRetry(id: string, entry: Running) {
    const failures = (this.failures.get(id) ?? 0) + 1;
    this.failures.set(id, failures);
    const delay = Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS);
    this.timers.set(
      id,
      setTimeout(() => {
        if (this.running.get(id) === entry && !this.disposed) {
          this.stopProvider(id);
          this.startProvider(id);
          this.recompute();
        }
      }, delay),
    );
  }

  private fail(id: string, entry: Running, error: unknown) {
    entry.state = { state: 'unavailable' };
    if (!entry.failed) {
      entry.failed = true;
      console.error(`Status source "${id}" failed`, error);
    }
  }

  /** Emissions from a stopped or replaced start are ignored: only the current one counts. */
  private receive(id: string, entry: Running, raw: unknown) {
    if (this.disposed || this.running.get(id) !== entry || entry.abort.signal.aborted) {
      return;
    }
    const state = readSourceState(raw);
    if (!state) {
      this.fail(id, entry, new Error('Invalid now-playing state'));
    } else {
      entry.state = state;
      entry.failed = false;
      this.failures.delete(id);
      this.requestArtwork(state);
    }
    this.recompute();
  }

  private requestArtwork(state: NowPlayingSourceState) {
    if (state.state !== 'ready') {
      return;
    }
    for (const { artwork } of state.sessions) {
      if (artwork !== undefined && !this.art.has(artwork)) {
        this.art.set(artwork, null);
        void this.host
          .resolveArtwork(artwork)
          .catch(() => null)
          .then((url) => {
            if (!this.disposed && this.art.has(artwork)) {
              this.art.set(artwork, url);
              this.recompute();
            }
          });
      }
    }
  }

  private candidates() {
    const found: Candidate[] = [];
    for (const [provider, entry] of this.running) {
      if (entry.state?.state === 'ready') {
        for (const session of entry.state.sessions) {
          found.push({ provider, session, native: nativeIdentity(session) });
        }
      }
    }
    return found;
  }

  private unavailable(filter: readonly string[]) {
    return providersFor(filter, this.running.keys()).some(
      (id) => this.running.get(id)?.state?.state === 'unavailable',
    );
  }

  private widgets(candidates: readonly Candidate[]) {
    const widgets: Record<string, WidgetStatus> = {};
    const previous = this.picked;
    this.picked = new Map();
    for (const [controlId, filter] of this.filters) {
      const chosen = filter
        ? selectSession(candidates, filter, previous.get(controlId))
        : undefined;
      if (!chosen) {
        widgets[controlId] = { unavailable: filter !== null && this.unavailable(filter) };
        continue;
      }
      this.picked.set(controlId, candidateKey(chosen));
      const artworkUrl = chosen.session.artwork ? this.art.get(chosen.session.artwork) : null;
      widgets[controlId] = {
        candidate: chosen,
        unavailable: false,
        ...(artworkUrl ? { artworkUrl } : {}),
      };
    }
    return widgets;
  }

  private recompute() {
    const candidates = this.candidates();
    const live = new Set(candidates.map(({ session }) => session.artwork));
    for (const handle of [...this.art.keys()]) {
      if (!live.has(handle)) {
        this.art.delete(handle);
      }
    }
    let view: StatusSnapshot = {
      catalogue: liveApps(candidates).slice(0, MAX_CATALOGUE),
      widgets: this.widgets(candidates),
    };
    let signature = JSON.stringify(view);
    const oversized = signature.length > MAX_STATUS_BYTES;
    if (oversized) {
      view = {
        catalogue: [],
        widgets: Object.fromEntries(
          Object.keys(view.widgets).map((id) => [id, { unavailable: true }]),
        ),
      };
      signature = JSON.stringify(view);
    }
    if (oversized && !this.oversized) {
      console.error('Now-playing status is too large to publish');
    }
    this.oversized = oversized;
    if (signature !== this.signature) {
      this.signature = signature;
      this.view = view;
      this.host.onChange();
    }
  }
}

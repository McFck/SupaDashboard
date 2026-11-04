// One lyrics tile: Spotify's session, its lyrics, the sung line and the follow scroll that keeps it in view.
import { prefersReducedMotion } from 'svelte/motion';
import type { NowPlayingSession } from '../../../features/plugins/contracts';
import { nativeSessions } from '../../../platform/media';
import { getLyrics, type LyricsView } from '../../../platform/lyrics';
import { lineAt, positionAt } from '../lyric-clock';
import { KineticScroll } from './kinetic-scroll';

export type TileView = { kind: 'idle' } | { kind: 'loading' } | LyricsView;
type Host = { visible(): boolean; offsetMs(): number };

/** Follow waits this long (ms) after the user's scrolling comes to rest, then glides back to the sung line. */
const HOLD_MS = 4000;
/** Height fraction where the sung line rests. */
const ANCHOR = 0.4;

const pick = (sessions: readonly NowPlayingSession[]) =>
  sessions.find((session) => session.current) ??
  sessions.find((session) => session.state === 'playing') ??
  sessions[0];

export class LyricsTileController {
  view = $state<TileView>({ kind: 'idle' });
  active = $state(-1);
  #scroll: KineticScroll | undefined;
  #content: HTMLElement | undefined;
  readonly #host: Host;
  #session = $state<NowPlayingSession>();
  #key = '';
  #epoch = 0;
  #frame = 0;
  #loop = false;
  #held = false;
  #holdTimer: ReturnType<typeof setTimeout> | undefined;
  /** The next scroll lands without animation: new lyrics, or a resize. */
  #jump = true;
  readonly #abort = new AbortController();
  readonly #stop: () => void;

  constructor(host: Host) {
    this.#host = host;
    this.#stop = nativeSessions('spotify')((state) => {
      this.#show(state.state === 'ready' ? pick(state.sessions) : undefined);
    }, this.#abort.signal);
    $effect(() => {
      const session = this.#session;
      this.#host.offsetMs();
      if (this.view.kind !== 'synced' || !session || !this.#host.visible()) {
        return;
      }
      this.#loop = session.state === 'playing';
      this.#frame = requestAnimationFrame(this.#tick);
      return () => {
        this.#loop = false;
        cancelAnimationFrame(this.#frame);
      };
    });
  }

  #show(session: NowPlayingSession | undefined) {
    const timeline = session?.timeline;
    const durationMs = timeline ? timeline.endMs - timeline.startMs : 0;
    const present = session && session.state !== 'stopped' && (session.title || session.artist);
    this.#session = present ? session : undefined;
    const key = present
      ? JSON.stringify([
          session.artist,
          session.title,
          session.album,
          Math.round(durationMs / 1000),
        ])
      : '';
    if (key === this.#key) {
      return;
    }
    this.#key = key;
    const mine = ++this.#epoch;
    this.active = -1;
    this.#jump = true;
    if (!present) {
      this.view = { kind: 'idle' };
      return;
    }
    this.view = { kind: 'loading' };
    // The duration is how LRCLIB tells versions apart; without it the lookup waits for the timeline.
    if (durationMs < 1000) {
      return;
    }
    const { artist, title, album } = session;
    // The native side takes whole milliseconds.
    void getLyrics({ artist, title, album, durationMs: Math.round(durationMs) }).then((view) => {
      if (mine === this.#epoch) {
        this.view = view;
      }
    });
  }

  #tick = () => {
    const session = this.#session;
    if (session && this.view.kind === 'synced') {
      const position = positionAt(session, Date.now(), this.#host.offsetMs());
      const index = position === null ? -1 : lineAt(this.view.lines, position);
      if (index !== this.active) {
        this.active = index;
        this.#follow();
      }
    }
    if (this.#loop) {
      this.#frame = requestAnimationFrame(this.#tick);
    }
  };

  /** Scrolls the sung line to its resting height unless the user holds the scroll. */
  #follow() {
    const line = this.#content?.children[Math.max(0, this.active)];
    if (!this.#scroll || this.#held || !(line instanceof HTMLElement)) {
      return;
    }
    const top = line.offsetTop + line.offsetHeight / 2 - this.#scroll.height * ANCHOR;
    const smooth = !this.#jump && !prefersReducedMotion.current;
    this.#jump = false;
    this.#scroll.scrollTo(top, smooth);
  }

  /** Action for the scroller, whose first child is the content it moves. */
  scroller = (node: HTMLElement) => {
    const content = node.firstElementChild;
    if (!(content instanceof HTMLElement)) {
      return;
    }
    const scroll = new KineticScroll(node, content, { onInput: this.#hold, onRest: this.#release });
    this.#scroll = scroll;
    this.#content = content;
    return {
      destroy: () => {
        scroll.destroy();
        if (this.#scroll === scroll) {
          this.#scroll = undefined;
          this.#content = undefined;
        }
      },
    };
  };

  #hold = () => {
    this.#held = true;
    clearTimeout(this.#holdTimer);
  };

  #release = () => {
    clearTimeout(this.#holdTimer);
    this.#holdTimer = setTimeout(() => {
      this.#held = false;
      this.#follow();
    }, HOLD_MS);
  };

  /** The tile changed size: put the sung line back at once. */
  recenter() {
    this.#jump = true;
    this.#follow();
  }

  destroy() {
    this.#abort.abort();
    this.#stop();
    this.#loop = false;
    cancelAnimationFrame(this.#frame);
    clearTimeout(this.#holdTimer);
    this.#epoch++;
  }
}

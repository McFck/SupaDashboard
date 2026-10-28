// Page coordination for the dashboard: which pages are framed where, a released swipe turned into a page request
// and a settle, and reconciliation when the page changes for any other reason (dots, actions, another window).
import { tick } from 'svelte';
import type { Page } from '../settings/schema';
import { PageMotion } from './page-motion';
import { pageSwipe, restingFrames, swipeFrames, type PagerFrame } from './page-swipe';
import { SwipeInput } from './swipe-input';

/** The pages one swipe works on, from the press until its settle ends; `generation` invalidates it. */
type Swipe = {
  sourceId: string;
  sourceIndex: number;
  order: string[];
  orderKey: string;
  width: number;
  side: number;
  generation: number;
};

/** What the dashboard should show after a swipe: a page change confirmed later is not "external". */
type Expectation = { pageId: string; orderKey: string; skin: string; fullscreen: boolean };

export type PagerHost = {
  shell(): HTMLElement;
  pages(): Page[];
  pageId(): string;
  skinId(): string;
  /** The skin navigates pages itself, so empty-area swipes do nothing. */
  skinNavigates(): boolean;
  fullscreen(): boolean;
  /** The window can be moved by dragging (native and not fullscreen). */
  canDragWindow(): boolean;
  startWindowDrag(): void;
  requestPage(pageId: string): Promise<boolean>;
  /** Pages finished moving: the drag areas must be observed and measured again. */
  onSettled(): void;
  /** Pages moved or a session ended: the drag areas must be measured again. */
  onChanged(): void;
};

export const pageOrderKey = (pages: readonly Page[]) => pages.map((page) => page.id).join('\u0000');

export class Pager {
  frames = $state<PagerFrame[]>([]);
  /** A swipe or its settle animation is running. */
  busy = $state(false);
  readonly motion = new PageMotion();
  readonly input: SwipeInput;

  private swipe: Swipe | null = null;
  private generation = 0;
  private expected: Expectation | null = null;
  private tracked: Expectation = { pageId: '', orderKey: '', skin: '', fullscreen: false };

  constructor(private readonly host: PagerHost) {
    this.input = new SwipeInput({
      shell: host.shell,
      pressMode: () => this.pressMode(),
      canDragWindow: host.canDragWindow,
      startWindowDrag: host.startWindowDrag,
      begin: () => this.begin(),
      move: (dx) => this.paint(dx),
      release: (dx) => void this.release(dx),
      tapped: () => {
        this.busy = false;
        this.host.onChanged();
      },
      yielded: () => {
        this.busy = false;
        this.frames = this.activeFrames(this.swipe?.sourceId);
        this.host.onChanged();
      },
      abort: () => this.cancelToCurrent(),
    });
  }

  start() {
    this.frames = this.activeFrames(this.host.pageId());
    this.tracked = this.currentState(this.host.pageId());
  }

  destroy() {
    this.cancelToCurrent();
  }

  /** Called whenever the shown page, page order, skin or fullscreen may have changed. */
  reconcile(pageId: string) {
    const current = this.currentState(pageId);
    const expected = this.expected;
    if (expected && sameState(expected, current)) {
      this.tracked = current;
      this.expected = null;
      return;
    }
    if (!sameState(this.tracked, current)) {
      this.tracked = current;
      this.cancelToCurrent(pageId);
    }
  }

  resize() {
    if (this.busy) {
      this.cancelToCurrent();
    } else {
      this.frames = this.activeFrames();
    }
    this.host.onChanged();
  }

  private cancelToCurrent(pageId = this.host.pageId()) {
    this.input.cancel();
    this.generation++;
    this.motion.cancel();
    this.expected = null;
    this.frames = this.activeFrames(pageId);
    this.busy = false;
    this.host.onChanged();
  }

  private pressMode(): 'none' | 'window' | 'swipe' {
    const pages = this.host.pages();
    const pageId = this.host.pageId();
    if (!pages.some((candidate) => candidate.id === pageId)) {
      return 'none';
    }
    if (pages.length <= 1) {
      return 'window';
    }
    return this.host.skinNavigates() ? 'none' : 'swipe';
  }

  private begin() {
    this.motion.cancel();
    const order = this.host.pages().map((candidate) => candidate.id);
    const sourceId = this.host.pageId();
    this.swipe = {
      sourceId,
      sourceIndex: order.indexOf(sourceId),
      order,
      orderKey: order.join('\u0000'),
      width: this.host.shell().getBoundingClientRect().width,
      side: 0,
      generation: ++this.generation,
    };
    this.busy = true;
  }

  private currentState(pageId: string): Expectation {
    return {
      pageId,
      orderKey: pageOrderKey(this.host.pages()),
      skin: this.host.skinId(),
      fullscreen: this.host.fullscreen(),
    };
  }

  private activeFrames(pageId = this.host.pageId()) {
    const order = this.host.pages().map((candidate) => candidate.id);
    return restingFrames(order, pageId, this.host.shell().getBoundingClientRect().width);
  }

  private paint(dx: number) {
    const swipe = this.swipe;
    if (swipe) {
      const { frames, side } = swipeFrames(swipe.order, swipe.sourceIndex, swipe.width, dx);
      swipe.side = side;
      this.frames = frames;
    }
  }

  /** Asks the runtime for the page a released swipe points at, then springs to whatever page is shown. */
  private async release(dx: number | null) {
    const swipe = this.swipe;
    if (!swipe) {
      return;
    }
    const now = this.currentState(this.host.pageId());
    const valid =
      dx !== null &&
      now.orderKey === swipe.orderKey &&
      now.skin === this.tracked.skin &&
      now.fullscreen === this.tracked.fullscreen &&
      now.pageId === swipe.sourceId &&
      this.generation === swipe.generation;
    if (!valid) {
      if (this.generation === swipe.generation) {
        void this.settle(swipe, swipe.sourceId);
      }
      return;
    }

    const { targetIndex } = pageSwipe(dx, swipe.width, swipe.sourceIndex, swipe.order.length);
    const targetId = swipe.order[targetIndex] ?? swipe.sourceId;
    let accepted = targetId === swipe.sourceId;
    if (!accepted) {
      this.expected = { ...now, pageId: targetId };
      try {
        accepted = await this.host.requestPage(targetId);
      } catch {
        accepted = false;
      }
    }
    await tick();
    if (this.generation !== swipe.generation) {
      return;
    }
    const shown = this.host.pageId();
    if (accepted && shown === targetId) {
      void this.settle(swipe, targetId);
      return;
    }
    this.expected = null;
    if (shown !== swipe.sourceId) {
      this.cancelToCurrent();
    } else {
      void this.settle(swipe, swipe.sourceId);
    }
  }

  /** Springs the visible frames so `targetId` ends centred, then parks its neighbours again. */
  private async settle(swipe: Swipe, targetId: string) {
    const pages = this.host.pages();
    const targetIndex = pages.findIndex((candidate) => candidate.id === targetId);
    const sourceIndex = pages.findIndex((candidate) => candidate.id === swipe.sourceId);
    if (targetIndex < 0 || sourceIndex < 0 || Math.abs(targetIndex - sourceIndex) > 1) {
      this.cancelToCurrent();
      return;
    }
    const side = Math.sign(targetIndex - sourceIndex) || swipe.side;
    const frames = this.frames.map((frame) => ({
      ...frame,
      active: frame.id === targetId,
      mediaVisible: frame.id === targetId || frame.id === swipe.sourceId,
    }));
    if (!frames.some((frame) => frame.id === targetId)) {
      frames.push({ id: targetId, offset: side * swipe.width, active: false, mediaVisible: true });
    }
    this.frames = frames;
    await tick();
    if (this.generation !== swipe.generation) {
      return;
    }

    await this.motion.spring(frames, (frame) => {
      if (frame.id === targetId) {
        return 0;
      }
      return frame.id === swipe.sourceId ? -side * swipe.width : frame.offset;
    });
    if (this.generation !== swipe.generation) {
      return;
    }

    this.frames = this.activeFrames(targetId);
    await tick();
    if (this.generation !== swipe.generation) {
      return;
    }
    this.motion.cancel();
    this.busy = false;
    this.expected = null;
    this.host.onSettled();
  }
}

function sameState(a: Expectation, b: Expectation) {
  return (
    a.pageId === b.pageId &&
    a.orderKey === b.orderKey &&
    a.skin === b.skin &&
    a.fullscreen === b.fullscreen
  );
}

// Page coordination for the dashboard: which pages are framed where, a released swipe turned into a page request
// and a settle, and reconciliation when the page changes for any other reason (dots, actions, another window).
import { tick } from 'svelte';
import type { Page } from '../settings/schema';
import { PageMotion } from './page-motion';
import {
  pageSwipeIntent,
  pageSwipe,
  restingFrames,
  swipeFrames,
  type PagerFrame,
} from './page-swipe';
/** Elements that take their own input; presses on them never swipe, and the drag gaps leave them out. */
export const INTERACTIVE =
  '[data-dashboard-tile], button, input, select, textarea, a, [contenteditable], [role="slider"]';

/** A press on an empty area that does not move becomes a window drag after this delay. */
const WINDOW_DRAG_HOLD_MS = 250;

type Session = {
  pointerId: number;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  source: 'gap' | 'skin-input';
  mode: 'pending' | 'horizontal' | 'vertical';
  hold?: ReturnType<typeof setTimeout>;
  frame: number | null;
};

/** The pages one swipe works on, from the press until its settle ends; `generation` invalidates it. */
type Swipe = {
  sourceId: string;
  sourceIndex: number;
  order: string[];
  key: string;
  width: number;
  side: number;
  generation: number;
};

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

const pageOrderKey = (pages: readonly Page[]) => pages.map((page) => page.id).join('\u0000');

export class Pager {
  frames = $state<PagerFrame[]>([]);
  /** A swipe or its settle animation is running. */
  busy = $state(false);
  readonly motion = new PageMotion();
  private session: Session | null = null;

  private swipe: Swipe | null = null;
  private generation = 0;
  private expected: string | null = null;
  private tracked = '';

  constructor(private readonly host: PagerHost) {}

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
    if (expected && expected === current) {
      this.tracked = current;
      this.expected = null;
      return;
    }
    if (this.tracked !== current) {
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
    if (this.session) {
      this.clear(this.session);
    }
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
      key: this.currentState(sourceId),
      width: this.host.shell().getBoundingClientRect().width,
      side: 0,
      generation: ++this.generation,
    };
    this.busy = true;
  }

  private currentState(pageId: string) {
    return JSON.stringify([
      pageId,
      pageOrderKey(this.host.pages()),
      this.host.skinId(),
      this.host.fullscreen(),
    ]);
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
    const valid = dx !== null && now === swipe.key && this.generation === swipe.generation;
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
      this.expected = this.currentState(targetId);
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
  private yielded() {
    this.busy = false;
    this.frames = this.activeFrames(this.swipe?.sourceId);
    this.host.onChanged();
  }

  pointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !event.isPrimary || event.button !== 0) {
      return;
    }
    const gap = target.closest('.dashboard-drag-gap');
    const skinInput = target.closest('[data-skin-input="scene"], [data-skin-input="slot"]');
    if (!gap && (!skinInput || target.closest(INTERACTIVE))) {
      return;
    }
    const mode = this.pressMode();
    if (mode === 'window' && gap && this.host.canDragWindow()) {
      event.preventDefault();
      this.host.startWindowDrag();
    }
    if (mode !== 'swipe') {
      return;
    }
    if (gap) {
      event.preventDefault();
    }
    if (this.session) {
      this.cancelToCurrent();
    }
    this.begin();

    const session: Session = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      latestX: event.clientX,
      latestY: event.clientY,
      source: gap ? 'gap' : 'skin-input',
      mode: 'pending',
      frame: null,
    };
    this.session = session;
    if (gap && this.host.canDragWindow()) {
      session.hold = setTimeout(() => this.dragWindow(session), WINDOW_DRAG_HOLD_MS);
    }
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onCancel, true);
    window.addEventListener('pointerdown', this.onNewPointerDown, true);
    window.addEventListener('blur', this.onBlur);
    this.host.shell().addEventListener('lostpointercapture', this.onLostCapture);
    if (gap) {
      try {
        this.host.shell().setPointerCapture(event.pointerId);
      } catch {
        // The window capture listeners also complete the pointer session.
      }
    }
  };

  private clear(session: Session, release = true) {
    if (this.session !== session) {
      return false;
    }
    this.session = null;
    clearTimeout(session.hold);
    if (session.frame !== null) {
      cancelAnimationFrame(session.frame);
    }
    session.frame = null;
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onCancel, true);
    window.removeEventListener('pointerdown', this.onNewPointerDown, true);
    window.removeEventListener('blur', this.onBlur);
    this.host.shell().removeEventListener('lostpointercapture', this.onLostCapture);
    if (release) {
      try {
        if (this.host.shell().hasPointerCapture(session.pointerId)) {
          this.host.shell().releasePointerCapture(session.pointerId);
        }
      } catch {
        // The window listeners also cover engines without pointer capture.
      }
    }
    return true;
  }

  private dragWindow(session: Session) {
    if (this.session !== session || !this.host.canDragWindow()) {
      return;
    }
    this.clear(session);
    this.yielded();
    this.host.startWindowDrag();
  }

  /** The first decisive movement picks the gesture: horizontal swipes pages, vertical drags or yields. */
  private lockIntent(session: Session, mode: 'horizontal' | 'vertical') {
    clearTimeout(session.hold);
    session.hold = undefined;
    session.mode = mode;
    if (mode === 'vertical') {
      if (session.source === 'skin-input') {
        if (this.clear(session, false)) {
          this.yielded();
        }
      } else if (this.host.canDragWindow()) {
        this.dragWindow(session);
      } else {
        this.cancelToCurrent();
      }
      return;
    }
    if (session.source === 'skin-input') {
      try {
        this.host.shell().setPointerCapture(session.pointerId);
      } catch {
        // Window capture listeners still track the horizontal swipe.
      }
    }
    this.paint(session.latestX - session.startX);
  }

  private onMove = (event: PointerEvent) => {
    const session = this.session;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    session.latestX = event.clientX;
    session.latestY = event.clientY;
    const dx = session.latestX - session.startX;
    const dy = session.latestY - session.startY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 1) {
      clearTimeout(session.hold);
      session.hold = undefined;
    }
    if (session.mode === 'pending') {
      const intent = pageSwipeIntent(dx, dy);
      if (intent !== 'pending') {
        this.lockIntent(session, intent);
      }
    }
    if (this.session === session && session.mode === 'horizontal') {
      if (event.cancelable) {
        event.preventDefault();
      }
      session.frame ??= requestAnimationFrame(() => {
        session.frame = null;
        if (this.session === session) {
          this.paint(session.latestX - session.startX);
        }
      });
    }
  };

  private onUp = (event: PointerEvent) => {
    const session = this.session;
    if (session?.pointerId === event.pointerId) {
      session.latestX = event.clientX;
      session.latestY = event.clientY;
      this.finish(session, false);
    }
  };

  private onCancel = (event: PointerEvent) => {
    const session = this.session;
    if (session?.pointerId === event.pointerId) {
      this.finish(session, true);
    }
  };

  private onLostCapture = (event: PointerEvent) => {
    const session = this.session;
    if (event.target === this.host.shell() && session?.pointerId === event.pointerId) {
      this.finish(session, true);
    }
  };

  private onBlur = () => {
    this.cancelToCurrent();
  };

  private onNewPointerDown = (event: PointerEvent) => {
    if (this.session && this.session.pointerId !== event.pointerId) {
      this.cancelToCurrent();
    }
  };

  private finish(session: Session, cancelled: boolean) {
    if (session.source === 'skin-input' && session.mode === 'pending') {
      if (this.clear(session, false)) {
        this.yielded();
      }
      return;
    }
    const swiped = !cancelled && session.mode === 'horizontal';
    const dx = session.latestX - session.startX;
    if (swiped) {
      this.paint(dx);
    }
    this.clear(session);
    void this.release(swiped ? dx : null);
  }
}

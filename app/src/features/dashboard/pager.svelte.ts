// Horizontal page swipes on the dashboard: one pointer session at a time, a spring to the target page, and
// reconciliation when the page changes for any other reason (dots, actions, another window).
import { tick } from 'svelte';
import { SPRING_SAMPLES, springDuration } from '$lib/spring';
import type { Page } from '../settings/schema';
import { pageSwipeIntent, pageSwipeOffset, pageSwipeTarget } from './page-swipe';

export type PagerFrame = { id: string; offset: number; active: boolean; mediaVisible: boolean };

type PagerSession = {
  pointerId: number;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  sourceId: string;
  sourceIndex: number;
  order: string[];
  orderKey: string;
  width: number;
  source: 'gap' | 'skin-input';
  mode: 'pending' | 'horizontal' | 'vertical';
  side: number;
  neighborId?: string;
  hold?: ReturnType<typeof setTimeout>;
  frame: number | null;
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

/** A press on an empty area that does not move becomes a window drag after this delay. */
const WINDOW_DRAG_HOLD_MS = 250;
const SETTLED_DISTANCE = 0.5;

const INTERACTIVE =
  '[data-dashboard-tile], button, input, select, textarea, a, [contenteditable], [role="slider"]';

export const pageOrderKey = (pages: readonly Page[]) => pages.map((page) => page.id).join('\u0000');

export function pageOffset(offset: number) {
  return `translate3d(${Number.isFinite(offset) ? offset : 0}px,0,0)`;
}

function springKeyframes(from: number, to: number) {
  return SPRING_SAMPLES.map((sample) => ({
    transform: pageOffset(from + (to - from) * sample.progress),
    offset: sample.offset,
  }));
}

export class Pager {
  frames = $state<PagerFrame[]>([]);
  /** A session or settle animation is running. */
  busy = $state(false);

  private session: PagerSession | null = null;
  private animations: Animation[] = [];
  private generation = 0;
  private expected: Expectation | null = null;
  private readonly pageNodes = new Map<string, HTMLElement>();
  private tracked: Expectation = { pageId: '', orderKey: '', skin: '', fullscreen: false };

  constructor(private readonly host: PagerHost) {}

  start() {
    this.frames = this.activeFrames(this.host.pageId());
    this.tracked = this.currentState(this.host.pageId());
  }

  destroy() {
    this.cancelToCurrent();
    this.cancelAnimations();
  }

  /** Svelte action for a page frame, so settle animations can reach it. */
  register = (node: HTMLElement, id: string) => {
    this.pageNodes.set(id, node);
    return {
      destroy: () => {
        if (this.pageNodes.get(id) === node) {
          this.pageNodes.delete(id);
        }
      },
    };
  };

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
    if (this.session || this.busy) {
      this.cancelToCurrent();
    } else {
      this.frames = this.activeFrames();
    }
    this.host.onChanged();
  }

  cancelToCurrent(pageId = this.host.pageId()) {
    const session = this.session;
    this.session = null;
    if (session) {
      clearTimeout(session.hold);
      if (session.frame !== null) {
        cancelAnimationFrame(session.frame);
      }
      this.removeListeners();
      this.releasePointer(session);
    }
    this.generation++;
    this.cancelAnimations();
    this.expected = null;
    this.frames = this.activeFrames(pageId);
    this.busy = false;
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
    const source = gap ? 'gap' : 'skin-input';
    const pages = this.host.pages();
    const pageId = this.host.pageId();
    const sourceIndex = pages.findIndex((candidate) => candidate.id === pageId);
    if (sourceIndex < 0) {
      return;
    }
    if (pages.length <= 1) {
      if (source === 'gap' && this.host.canDragWindow()) {
        event.preventDefault();
        this.host.startWindowDrag();
      }
      return;
    }
    if (this.host.skinNavigates()) {
      return;
    }
    if (source === 'gap') {
      event.preventDefault();
    }
    if (this.session) {
      this.cancelToCurrent();
    }
    this.cancelAnimations();

    const order = pages.map((candidate) => candidate.id);
    const session: PagerSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      latestX: event.clientX,
      latestY: event.clientY,
      sourceId: pageId,
      sourceIndex,
      order,
      orderKey: order.join('\u0000'),
      width: this.host.shell().getBoundingClientRect().width,
      mode: 'pending',
      side: 0,
      source,
      frame: null,
      generation: ++this.generation,
    };
    this.session = session;
    this.busy = true;
    if (source === 'gap' && this.host.canDragWindow()) {
      session.hold = setTimeout(() => this.startWindowDrag(session), WINDOW_DRAG_HOLD_MS);
    }
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onCancel, true);
    window.addEventListener('pointerdown', this.onNewPointerDown, true);
    window.addEventListener('blur', this.onBlur);
    this.host.shell().addEventListener('lostpointercapture', this.onLostCapture);
    if (source === 'gap') {
      try {
        this.host.shell().setPointerCapture(event.pointerId);
      } catch {
        // The window capture listeners also complete the pointer session.
      }
    }
  };

  private currentState(pageId: string): Expectation {
    return {
      pageId,
      orderKey: pageOrderKey(this.host.pages()),
      skin: this.host.skinId(),
      fullscreen: this.host.fullscreen(),
    };
  }

  /** The current page plus its neighbours parked one width to either side. */
  private activeFrames(pageId = this.host.pageId()): PagerFrame[] {
    const pages = this.host.pages();
    const index = pages.findIndex((candidate) => candidate.id === pageId);
    const width = this.host.shell().getBoundingClientRect().width;
    const frames: PagerFrame[] = [{ id: pageId, offset: 0, active: true, mediaVisible: true }];
    if (index > 0) {
      frames.unshift({
        id: pages[index - 1].id,
        offset: -width,
        active: false,
        mediaVisible: false,
      });
    }
    if (index >= 0 && index + 1 < pages.length) {
      frames.push({ id: pages[index + 1].id, offset: width, active: false, mediaVisible: false });
    }
    return frames;
  }

  private cancelAnimations() {
    for (const animation of this.animations) {
      animation.cancel();
    }
    this.animations = [];
  }

  private removeListeners() {
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onCancel, true);
    window.removeEventListener('pointerdown', this.onNewPointerDown, true);
    window.removeEventListener('blur', this.onBlur);
    this.host.shell().removeEventListener('lostpointercapture', this.onLostCapture);
  }

  private releasePointer(session: PagerSession) {
    try {
      if (this.host.shell().hasPointerCapture(session.pointerId)) {
        this.host.shell().releasePointerCapture(session.pointerId);
      }
    } catch {
      // The window listeners also cover engines without pointer capture.
    }
  }

  private clearSession(session: PagerSession, release = true) {
    if (this.session !== session) {
      return false;
    }
    this.session = null;
    clearTimeout(session.hold);
    if (session.frame !== null) {
      cancelAnimationFrame(session.frame);
    }
    session.frame = null;
    this.removeListeners();
    if (release) {
      this.releasePointer(session);
    }
    return true;
  }

  /** Ends a session without a page change and shows the source page at rest. */
  private settleInPlace(session: PagerSession) {
    this.busy = false;
    this.frames = this.activeFrames(session.sourceId);
    this.host.onChanged();
  }

  private startWindowDrag(session: PagerSession) {
    if (this.session !== session || !this.host.canDragWindow()) {
      return;
    }
    this.clearSession(session);
    this.settleInPlace(session);
    this.host.startWindowDrag();
  }

  private paint(session: PagerSession) {
    if (this.session !== session || session.mode !== 'horizontal') {
      return;
    }
    const dx = session.latestX - session.startX;
    const offset = pageSwipeOffset(dx, session.width, session.sourceIndex, session.order.length);
    const source = { id: session.sourceId, offset, active: true, mediaVisible: true };
    if (!session.neighborId) {
      this.frames = [source];
      return;
    }
    const neighbor = {
      id: session.neighborId,
      offset: session.side * session.width + dx,
      active: false,
      mediaVisible: true,
    };
    this.frames = [source, neighbor];
  }

  private schedulePaint(session: PagerSession) {
    if (session.frame !== null) {
      return;
    }
    session.frame = requestAnimationFrame(() => {
      session.frame = null;
      this.paint(session);
    });
  }

  /** The first decisive movement picks the gesture: horizontal swipes pages, vertical drags or yields. */
  private lockIntent(session: PagerSession, mode: 'horizontal' | 'vertical') {
    if (this.session !== session || session.mode !== 'pending') {
      return;
    }
    clearTimeout(session.hold);
    session.hold = undefined;
    session.mode = mode;
    if (mode === 'vertical') {
      if (session.source === 'skin-input') {
        if (this.clearSession(session, false)) {
          this.settleInPlace(session);
        }
      } else if (this.host.canDragWindow()) {
        this.startWindowDrag(session);
      } else {
        this.cancelToCurrent(session.sourceId);
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
    const dx = session.latestX - session.startX;
    session.side = dx < 0 ? 1 : -1;
    session.neighborId = session.order[session.sourceIndex + session.side];
    this.paint(session);
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
    if (session.mode === 'horizontal') {
      if (event.cancelable) {
        event.preventDefault();
      }
      this.schedulePaint(session);
    }
  };

  private onUp = (event: PointerEvent) => {
    const session = this.session;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    session.latestX = event.clientX;
    session.latestY = event.clientY;
    void this.finish(session, false);
  };

  private onCancel = (event: PointerEvent) => {
    const session = this.session;
    if (session?.pointerId === event.pointerId) {
      void this.finish(session, true);
    }
  };

  private onLostCapture = (event: PointerEvent) => {
    if (event.target !== this.host.shell()) {
      return;
    }
    const session = this.session;
    if (session?.pointerId === event.pointerId) {
      void this.finish(session, true);
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

  /** Releases a swipe: asks the runtime for the target page, then springs to whatever page is shown. */
  private async finish(session: PagerSession, cancelled: boolean) {
    if (this.session !== session) {
      return;
    }
    if (session.source === 'skin-input' && session.mode === 'pending') {
      if (this.clearSession(session, false)) {
        this.busy = false;
        this.host.onChanged();
      }
      return;
    }
    if (session.frame !== null) {
      cancelAnimationFrame(session.frame);
    }
    session.frame = null;
    if (!cancelled && session.mode === 'horizontal') {
      this.paint(session);
    }
    if (!this.clearSession(session)) {
      return;
    }

    const now = this.currentState(this.host.pageId());
    const valid =
      !cancelled &&
      session.mode === 'horizontal' &&
      now.orderKey === session.orderKey &&
      now.skin === this.tracked.skin &&
      now.fullscreen === this.tracked.fullscreen &&
      now.pageId === session.sourceId &&
      this.generation === session.generation;
    if (!valid) {
      if (this.generation === session.generation) {
        void this.animate(session, session.sourceId);
      }
      return;
    }

    const dx = session.latestX - session.startX;
    const targetIndex = pageSwipeTarget(
      dx,
      session.width,
      session.sourceIndex,
      session.order.length,
    );
    const targetId = session.order[targetIndex] ?? session.sourceId;
    let accepted = targetId === session.sourceId;
    if (!accepted) {
      this.expected = { ...now, pageId: targetId };
      try {
        accepted = await this.host.requestPage(targetId);
      } catch {
        accepted = false;
      }
    }
    await tick();
    if (this.generation !== session.generation) {
      return;
    }
    const shown = this.host.pageId();
    if (!accepted || shown !== targetId) {
      this.expected = null;
      if (shown !== session.sourceId) {
        this.cancelToCurrent();
      } else {
        void this.animate(session, session.sourceId);
      }
      return;
    }
    void this.animate(session, targetId);
  }

  /** Springs the visible frames so `targetId` ends centred, then parks its neighbours again. */
  private async animate(session: PagerSession, targetId: string) {
    if (this.generation !== session.generation) {
      return;
    }
    const pages = this.host.pages();
    const targetIndex = pages.findIndex((candidate) => candidate.id === targetId);
    const sourceIndex = pages.findIndex((candidate) => candidate.id === session.sourceId);
    if (targetIndex < 0 || sourceIndex < 0 || Math.abs(targetIndex - sourceIndex) > 1) {
      this.cancelToCurrent();
      return;
    }
    const side = targetIndex > sourceIndex ? 1 : targetIndex < sourceIndex ? -1 : session.side;
    const frames = this.frames.map((frame) => ({
      ...frame,
      active: frame.id === targetId,
      mediaVisible: frame.id === targetId || frame.id === session.sourceId,
    }));
    if (!frames.some((frame) => frame.id === targetId)) {
      frames.push({
        id: targetId,
        offset: side * session.width,
        active: false,
        mediaVisible: true,
      });
    }
    this.frames = frames;
    await tick();
    if (this.generation !== session.generation) {
      return;
    }

    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.animations = frames.flatMap((frame) => {
        const node = this.pageNodes.get(frame.id);
        const destination =
          frame.id === targetId
            ? 0
            : frame.id === session.sourceId
              ? -side * session.width
              : frame.offset;
        const distance = Math.abs(destination - frame.offset);
        if (!node || distance < SETTLED_DISTANCE) {
          return [];
        }
        return [
          node.animate(springKeyframes(frame.offset, destination), {
            duration: springDuration(distance),
            fill: 'both',
          }),
        ];
      });
      await Promise.all(
        this.animations.map((animation) => animation.finished.catch(() => undefined)),
      );
      if (this.generation !== session.generation) {
        return;
      }
    }

    this.frames = this.activeFrames(targetId);
    await tick();
    if (this.generation !== session.generation) {
      return;
    }
    this.cancelAnimations();
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

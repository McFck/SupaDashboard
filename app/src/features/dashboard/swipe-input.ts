// The pointer side of page swipes: which presses may swipe, one pointer session with its listeners and capture,
// the horizontal/vertical intent lock, and handing a still or vertical press over to a native window drag.
import { pageSwipeIntent } from './page-swipe';

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

export type SwipeInputHost = {
  shell(): HTMLElement;
  /** What a press may do: nothing, only drag the window (a single page), or swipe pages. */
  pressMode(): 'none' | 'window' | 'swipe';
  canDragWindow(): boolean;
  startWindowDrag(): void;
  /** A swipe session starts. */
  begin(): void;
  /** Horizontal travel since the press, at most once per frame. */
  move(dx: number): void;
  /** The pointer was released; `dx` is null when it was cancelled or never moved horizontally. */
  release(dx: number | null): void;
  /** A press on the skin ended before it became a swipe. */
  tapped(): void;
  /** The press became a vertical skin gesture or a window drag: show the page at rest. */
  yielded(): void;
  /** The press was interrupted (blur, another pointer, a vertical drag that cannot move the window). */
  abort(): void;
};

export class SwipeInput {
  private session: Session | null = null;

  constructor(private readonly host: SwipeInputHost) {}

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
    const mode = this.host.pressMode();
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
      this.host.abort();
    }
    this.host.begin();

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

  /** Ends the session without telling the host; the pager calls this while it resets. */
  cancel() {
    if (this.session) {
      this.clear(this.session);
    }
  }

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
    this.host.yielded();
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
          this.host.yielded();
        }
      } else if (this.host.canDragWindow()) {
        this.dragWindow(session);
      } else {
        this.host.abort();
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
    this.host.move(session.latestX - session.startX);
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
          this.host.move(session.latestX - session.startX);
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
    this.host.abort();
  };

  private onNewPointerDown = (event: PointerEvent) => {
    if (this.session && this.session.pointerId !== event.pointerId) {
      this.host.abort();
    }
  };

  private finish(session: Session, cancelled: boolean) {
    if (session.source === 'skin-input' && session.mode === 'pending') {
      if (this.clear(session, false)) {
        this.host.tapped();
      }
      return;
    }
    const swiped = !cancelled && session.mode === 'horizontal';
    const dx = session.latestX - session.startX;
    if (swiped) {
      this.host.move(dx);
    }
    this.clear(session);
    this.host.release(swiped ? dx : null);
  }
}

// The native dashboard window: placement and display mode, the hidden-until-placed reveal, and the hover and
// resize state that drives the edge cues and page dots.
import { tick } from 'svelte';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { applyDisplay, getAppliedFullscreen, initDisplay } from '../display/display';
import type { Page, Settings } from '../settings/schema';

type DisplayRequest = { monitor: string | null; fullscreen: boolean; alwaysOnTop: boolean };
type HoverEvent = { hovered: boolean; revision: number; clearClient?: boolean };
type ResizeEvent = { resizing: boolean; revision: number };

/** Native resize loops swallow pointer hover, so the edge cues stay up until resize events go quiet. */
const RESIZE_QUIET_MS = 400;

const requestOf = (display: Settings['display']): DisplayRequest => ({
  monitor: display.monitor,
  fullscreen: display.fullscreen,
  alwaysOnTop: display.alwaysOnTop,
});

const sameRequest = (a: DisplayRequest | null, b: DisplayRequest) =>
  !!a &&
  a.monitor === b.monitor &&
  a.fullscreen === b.fullscreen &&
  a.alwaysOnTop === b.alwaysOnTop;

export class DashboardWindow {
  ready = $state(false);
  appliedFullscreen = $state(false);
  domHovered = $state(false);
  private nativeHovered = $state(false);
  private windowResizing = $state(false);
  private nativeResizing = $state(false);

  /** Edge cues and page dots show while the pointer is over the window or it is being resized. */
  readonly showChrome = $derived(
    this.domHovered || this.nativeHovered || this.windowResizing || this.nativeResizing,
  );

  private nativeHoverRevision = -1;
  private nativeResizeRevision = -1;
  private resizeQuiet: ReturnType<typeof setTimeout> | undefined;
  private lastSuccessfulRequest: DisplayRequest | null = null;
  private lastFailedRequest: DisplayRequest | null = null;
  private draining = false;
  private disposed = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly display: () => Settings['display'],
    private readonly onWindowResized: () => void,
  ) {}

  /** Places the window for the stored display settings, then shows it and follows later display edits. */
  start(page: Page) {
    const initial = $state.snapshot(this.display());
    void this.initialize(initial, page).catch((error) =>
      console.warn('dashboard reveal failed', error),
    );
  }

  /** Display settings may have changed: apply them unless that exact request already ran. */
  requestChanged() {
    if (this.ready && this.isNewRequest(requestOf(this.display()))) {
      void this.drain();
    }
  }

  showResizeCues() {
    this.windowResizing = true;
    clearTimeout(this.resizeQuiet);
    this.resizeQuiet = setTimeout(() => {
      this.windowResizing = false;
    }, RESIZE_QUIET_MS);
  }

  startResize(
    direction: Parameters<ReturnType<typeof getCurrentWindow>['startResizeDragging']>[0],
  ) {
    this.showResizeCues();
    getCurrentWindow()
      .startResizeDragging(direction)
      .catch((error) => console.warn('resize', error));
  }

  startDrag() {
    getCurrentWindow()
      .startDragging()
      .catch((error) => console.warn('drag', error));
  }

  destroy() {
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0)) {
      cleanup();
    }
    clearTimeout(this.resizeQuiet);
  }

  private isNewRequest(request: DisplayRequest) {
    return (
      !sameRequest(this.lastSuccessfulRequest, request) &&
      !sameRequest(this.lastFailedRequest, request)
    );
  }

  private async initialize(initial: Settings['display'], page: Page) {
    if (isTauri()) {
      await this.listenToWindow();
    }
    let cleanupDisplay: (() => void) | undefined;
    try {
      cleanupDisplay = await initDisplay(initial, page, () => this.disposed);
      if (this.disposed) {
        cleanupDisplay?.();
        return;
      }
      this.appliedFullscreen = getAppliedFullscreen();
      this.lastSuccessfulRequest = { ...requestOf(initial), fullscreen: this.appliedFullscreen };
    } catch (error) {
      if (this.disposed) {
        return;
      }
      console.warn('display initialization failed; showing the safe dashboard window', error);
      this.appliedFullscreen = false;
      this.lastFailedRequest = requestOf(initial);
    }
    if (this.disposed) {
      cleanupDisplay?.();
      return;
    }
    if (cleanupDisplay) {
      this.cleanups.push(cleanupDisplay);
    }

    this.ready = true;
    await tick();
    if (!this.disposed && isTauri()) {
      await getCurrentWindow().show();
    }
    void this.drain();
  }

  private async listenToWindow() {
    try {
      const appWindow = getCurrentWindow();
      this.keep(
        await appWindow.onResized(() => {
          this.onWindowResized();
          if (this.ready && !this.appliedFullscreen) {
            this.showResizeCues();
          }
        }),
      );
      this.keep(
        await listen<HoverEvent>('dashboard-hover', (event) => {
          const payload = event.payload;
          const stale =
            !Number.isSafeInteger(payload.revision) || payload.revision <= this.nativeHoverRevision;
          if (this.disposed || stale) {
            return;
          }
          this.nativeHoverRevision = payload.revision;
          this.nativeHovered = payload.hovered === true;
          if (payload.clearClient) {
            this.domHovered = false;
          }
        }),
      );
      this.keep(
        await listen<ResizeEvent>('dashboard-resize', (event) => {
          const { resizing, revision } = event.payload;
          if (this.disposed || revision <= this.nativeResizeRevision) {
            return;
          }
          this.nativeResizeRevision = revision;
          this.nativeResizing = resizing;
          clearTimeout(this.resizeQuiet);
          this.resizeQuiet = undefined;
          this.windowResizing = resizing;
        }),
      );
    } catch (error) {
      console.warn('dashboard hover listener', error);
    }
  }

  private keep(cleanup: () => void) {
    if (this.disposed) {
      cleanup();
    } else {
      this.cleanups.push(cleanup);
    }
  }

  /** Applies display requests one at a time until the latest one has been applied or has failed. */
  private async drain() {
    if (!this.ready || this.disposed || this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (!this.disposed) {
        const display = $state.snapshot(this.display());
        const request = requestOf(display);
        if (!this.isNewRequest(request)) {
          break;
        }
        try {
          const fullscreen = await applyDisplay(display);
          if (this.disposed) {
            break;
          }
          this.appliedFullscreen = fullscreen;
          this.lastSuccessfulRequest = request;
          this.lastFailedRequest = null;
        } catch (error) {
          if (!this.disposed) {
            console.warn('display', error);
          }
          this.lastFailedRequest = request;
          break;
        }
        if (sameRequest(requestOf(this.display()), request)) {
          break;
        }
      }
    } finally {
      this.draining = false;
      if (!this.disposed && this.ready && this.isNewRequest(requestOf(this.display()))) {
        queueMicrotask(() => void this.drain());
      }
    }
  }
}

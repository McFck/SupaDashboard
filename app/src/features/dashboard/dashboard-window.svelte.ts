// The native dashboard window: the hidden-until-placed reveal, the hover and resize state that drives the edge cues
// and page dots, and window drags. Placement and display mode belong to the display controller.
import { tick } from 'svelte';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { startDisplay, type DisplayController } from '../display/display';
import type { Page, Settings } from '../settings/schema';
import { toast } from 'svelte-sonner';

type HoverEvent = { hovered: boolean; revision: number; clearClient?: boolean };
type ResizeEvent = { resizing: boolean; revision: number };

/** Native resize loops swallow pointer hover, so the edge cues stay up until resize events go quiet. */
const RESIZE_QUIET_MS = 400;

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
  private controller: DisplayController | null = null;
  private disposed = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly display: () => Settings['display']) {}

  /** Places the window for the stored display settings, then shows it and follows later display edits. */
  start(page: Page) {
    const initial = $state.snapshot(this.display());
    void this.initialize(initial, page).catch((error) =>
      console.warn('dashboard reveal failed', error),
    );
  }

  /** Display settings may have changed: the display controller applies them unless that request already ran. */
  requestChanged() {
    if (this.ready) {
      this.controller?.request(this.display());
    }
  }

  startDrag() {
    getCurrentWindow()
      .startDragging()
      .catch((error) => console.warn('drag', error));
  }

  startResize(
    direction: Parameters<ReturnType<typeof getCurrentWindow>['startResizeDragging']>[0],
  ) {
    if (!isTauri() || this.appliedFullscreen) {
      return;
    }
    this.showResizeCues();
    void getCurrentWindow()
      .startResizeDragging(direction)
      .catch(() => toast.error('Could not resize window'));
  }

  destroy() {
    this.disposed = true;
    this.controller?.dispose();
    for (const cleanup of this.cleanups.splice(0)) {
      cleanup();
    }
    clearTimeout(this.resizeQuiet);
  }

  private showResizeCues() {
    this.windowResizing = true;
    clearTimeout(this.resizeQuiet);
    this.resizeQuiet = setTimeout(() => {
      this.windowResizing = false;
    }, RESIZE_QUIET_MS);
  }

  private async initialize(initial: Settings['display'], page: Page) {
    if (isTauri()) {
      await this.listenToWindow();
    }
    try {
      const controller = await startDisplay(
        initial,
        page,
        () => this.disposed,
        (fullscreen) => {
          this.appliedFullscreen = fullscreen;
        },
      );
      if (this.disposed) {
        controller?.dispose();
        return;
      }
      this.controller = controller;
    } catch (error) {
      if (this.disposed) {
        return;
      }
      console.warn('display initialization failed; showing the safe dashboard window', error);
    }

    this.ready = true;
    await tick();
    if (!this.disposed && isTauri()) {
      await getCurrentWindow().show();
    }
    this.requestChanged();
  }

  private async listenToWindow() {
    try {
      const appWindow = getCurrentWindow();
      this.keep(
        await appWindow.onResized(() => {
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
}

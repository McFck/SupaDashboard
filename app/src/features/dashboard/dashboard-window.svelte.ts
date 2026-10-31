// The native dashboard window: the hidden-until-placed reveal, the hover and resize state that drives the edge cues
// and page dots, and window drags. Placement and display mode belong to the display controller.
import { tick } from 'svelte';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { startDisplay, type DisplayController } from '../display/display';
import type { Page, Settings } from '../settings/schema';
import { toast } from 'svelte-sonner';
import { setDashboardBackdrop, startTouchWindowAction } from '../../platform/window';

type HoverEvent = { hovered: boolean; revision: number; clearClient?: boolean };
type ResizeEvent = { resizing: boolean; revision: number };

/** Native resize loops swallow pointer hover, so the edge cues stay up until resize events go quiet. */
const RESIZE_QUIET_MS = 400;

export class DashboardWindow {
  ready = $state(false);
  appliedFullscreen = $state(false);
  private domHovered = $state(false);
  private nativeHovered = $state(false);
  private windowResizing = $state(false);
  private nativeResizing = $state(false);

  /** Edge cues and page dots show while the pointer is over the window or it is being resized. */
  readonly showChrome = $derived(
    this.domHovered || this.nativeHovered || this.windowResizing || this.nativeResizing,
  );

  /**
   * The shell and the resize grips are separate elements, and the order of their enter and leave events is not
   * guaranteed, so only a leave towards something outside both clears the hover.
   */
  readonly pointerEnter = (event: PointerEvent) => {
    // A tap on a touchscreen also fires enter and leave; only a hovering mouse or pen shows the chrome.
    if (event.pointerType !== 'touch') {
      this.domHovered = true;
    }
  };
  readonly pointerLeave = (event: PointerEvent) => {
    const next = event.relatedTarget;
    if (!(next instanceof Element && next.closest('.dashboard-shell, .resize-grips'))) {
      this.domHovered = false;
    }
  };

  private nativeHoverRevision = -1;
  private nativeResizeRevision = -1;
  private resizeQuiet: ReturnType<typeof setTimeout> | undefined;
  private controller: DisplayController | null = null;
  private disposed = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly display: () => Settings['display'],
    private readonly grid: () => { page: Page; bottomInset: number },
  ) {}

  /** Places the window for the stored display settings, then shows it and follows later display edits. */
  start() {
    const initial = $state.snapshot(this.display());
    void this.initialize(initial).catch((error) => console.warn('dashboard reveal failed', error));
  }

  gridChanged() {
    if (this.ready) {
      const { page, bottomInset } = this.grid();
      void this.controller?.updateGrid(page, bottomInset);
    }
  }

  /** Display settings may have changed: the display controller applies them unless that request already ran. */
  requestChanged() {
    if (this.ready) {
      this.controller?.request(this.display());
    }
  }

  /** The native backdrop follows the window's moves and visibility itself; it only hears mode and radius edits. */
  backdropChanged() {
    if (!isTauri()) {
      return;
    }
    const { mode, radius } = this.display().background;
    void setDashboardBackdrop(mode === 'wallpaper', radius).catch((error) => {
      console.warn('dashboard backdrop', error);
      toast.error('Could not show wallpaper');
    });
  }

  startDrag(pointerType: string) {
    const action =
      pointerType === 'touch' ? startTouchWindowAction('Move') : getCurrentWindow().startDragging();
    void action.catch(() => toast.error('Could not move window'));
  }

  startResize(
    direction: Parameters<ReturnType<typeof getCurrentWindow>['startResizeDragging']>[0],
    pointerType = 'mouse',
  ) {
    if (!isTauri() || this.appliedFullscreen) {
      return;
    }
    this.showResizeCues();
    const action =
      pointerType === 'touch'
        ? startTouchWindowAction(direction)
        : getCurrentWindow().startResizeDragging(direction);
    void action.catch(() => toast.error('Could not resize window'));
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

  private async initialize(initial: Settings['display']) {
    if (isTauri()) {
      await this.listenToWindow();
    }
    try {
      const { page, bottomInset } = this.grid();
      const controller = await startDisplay(
        initial,
        page,
        () => this.disposed,
        (fullscreen) => {
          this.appliedFullscreen = fullscreen;
        },
        bottomInset,
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
      toast.error('Could not configure dashboard window');
    }

    this.ready = true;
    await tick();
    // A chosen monitor that is not connected keeps the window hidden until the display controller reopens it.
    if (!this.disposed && isTauri() && this.controller && !this.controller.unavailable) {
      await getCurrentWindow().show();
    }
    this.requestChanged();
    this.gridChanged();
  }

  private async listenToWindow() {
    try {
      const appWindow = getCurrentWindow();
      this.keep(
        await listen('dashboard-touch-error', () => {
          toast.error('Could not process touch input', { id: 'dashboard-touch' });
        }),
      );
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

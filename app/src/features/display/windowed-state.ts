// The windowed (normal) dashboard rectangle: what fullscreen exit and the next start-up restore. It is written to
// window-state.json after the user moves or resizes the window and after every controller move of it.
import {
  connectedMonitors,
  setDashboardInteractionMode,
  type WindowStateStore,
} from '../../platform/window';
import type { Page } from '../settings/schema';
import type { ControlledWindow } from './controlled-window';
import {
  clampGeometryToWorkArea,
  monitorWithLargestIntersection,
  sameGeometry,
  startupPlacement,
} from './geometry';
import type { Geometry, MonitorGeometry } from './model';

const SAVE_DELAY_MS = 300;

type StartupPlacement = Awaited<ReturnType<WindowedBounds['startupPlacement']>>;

export class WindowedBounds {
  /** The windowed rectangle to restore on fullscreen exit, and the monitor it belongs to. */
  normal: Geometry | null = null;
  monitor: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly win: ControlledWindow,
    private readonly store: WindowStateStore,
  ) {}

  /** Where the window opens: the saved rectangle, or the deck's natural size, on the chosen monitor. */
  async startupPlacement(preferred: string | null, deck: Page) {
    const saved = await this.store.get<Geometry>('dashboard');
    const [{ screens, current, primary }, actual] = await Promise.all([
      connectedMonitors(),
      this.win.readBounds(),
    ]);
    return {
      screens,
      current,
      ...startupPlacement(screens, preferred, saved, primary, actual, deck),
    };
  }

  /** Applies the start-up rectangle in windowed mode; false when the controller went away meanwhile. */
  async restore({ screens, current, monitor: selected, bounds }: StartupPlacement) {
    return this.win.moving(async () => {
      await setDashboardInteractionMode(false);
      if (!this.win.live()) {
        return false;
      }
      const placed = await this.win.place(bounds);
      if (!this.win.live()) {
        return false;
      }
      const monitor =
        monitorWithLargestIntersection(placed, screens)?.name ??
        current?.name ??
        selected?.name ??
        null;
      // Save only a rectangle the native restore actually applied. One the OS still resized (a DPI change the
      // settled restore could not undo) would become the next start-up's input and compound.
      if (sameGeometry(placed, bounds)) {
        await this.save(placed, monitor);
      } else {
        this.keep(placed, monitor);
      }
      return true;
    });
  }

  keep(bounds: Geometry, monitor: string | null) {
    this.normal = bounds;
    this.monitor = monitor;
  }

  async save(bounds: Geometry, monitor: string | null) {
    this.keep(bounds, monitor);
    await this.store.set('dashboard', bounds);
  }

  /** Runs `save` once user moves and resizes have been quiet for a moment. */
  saveLater(save: () => void) {
    clearTimeout(this.timer);
    this.timer = setTimeout(save, SAVE_DELAY_MS);
  }

  cancelSave() {
    clearTimeout(this.timer);
  }

  async recordUserBounds(bounds: Geometry) {
    // Late resize events from the start-up restore land here too; an unchanged rectangle is not rewritten, so a
    // restore the OS resized stays out of the store until the user moves or resizes the window.
    if (!this.normal || !sameGeometry(bounds, this.normal)) {
      await this.store.set('dashboard', bounds);
    }
    this.normal = bounds;
    const { screens, current } = await connectedMonitors();
    this.monitor = monitorWithLargestIntersection(bounds, screens)?.name ?? current?.name ?? null;
  }

  /** While fullscreen on another monitor, the retained windowed rectangle follows, centered on the new monitor. */
  async followMonitor(target: MonitorGeometry) {
    if (this.normal && target.name !== this.monitor) {
      await this.save(
        clampGeometryToWorkArea(this.normal, target, true) ?? this.normal,
        target.name,
      );
    }
  }

  /** Moves the windowed dashboard onto `target`, centered there when the user chose that monitor. */
  async moveTo(target: MonitorGeometry, center: boolean, alwaysOnTop: boolean) {
    const win = this.win;
    const previousTopmost = win.topmost;
    await win.moving(async () => {
      try {
        win.step();
        await win.setTopmost(alwaysOnTop);
        const current = await win.readBounds();
        win.step();
        const placed = await win.placeIfDifferent(
          clampGeometryToWorkArea(current, target, center) ?? current,
        );
        win.step();
        await this.saveQuietly(placed, target.name);
      } catch (error) {
        await win.rollbackTopmost(previousTopmost);
        throw error;
      }
    });
  }

  /** Saves after a completed move; a failed write does not undo the move. */
  async saveQuietly(bounds: Geometry, monitor: string) {
    try {
      await this.save(bounds, monitor);
    } catch (error) {
      console.warn('window state', error);
    }
  }
}

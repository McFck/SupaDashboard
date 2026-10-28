// Fullscreen enter, exit and monitor moves of the dashboard window. A failed enter or exit puts the previous
// interaction mode, topmost state and rectangle back before the error propagates.
import { setDashboardInteractionMode } from '../../platform/window';
import {
  clampGeometryToWorkArea,
  monitorRect,
  monitorWithLargestIntersection,
  sameGeometry,
  validGeometry,
} from './geometry';
import type { ControlledWindow } from './controlled-window';
import type { Geometry, MonitorGeometry } from './model';
import type { WindowedBounds } from './windowed-state';

export class Fullscreen {
  active = false;
  /** The monitor the fullscreen window covers, and the rectangle it was given there. */
  monitor: string | null = null;
  private bounds: Geometry | null = null;

  constructor(
    private readonly win: ControlledWindow,
    private readonly windowed: WindowedBounds,
  ) {}

  async enter(
    target: MonitorGeometry,
    screens: MonitorGeometry[],
    current: MonitorGeometry | null,
  ) {
    const win = this.win;
    await win.moving(async () => {
      this.windowed.cancelSave();
      const previousTopmost = win.topmost;
      let modeChanged = false;
      try {
        win.step();
        const normal = await win.readBounds();
        win.step();
        const normalMonitor =
          monitorWithLargestIntersection(normal, screens)?.name ?? current?.name ?? target.name;
        await this.windowed.save(normal, normalMonitor);
        win.step();

        await setDashboardInteractionMode(true);
        modeChanged = true;
        win.step();
        await win.setTopmost(true);
        const placed = await win.placeIfDifferent(monitorRect(target));
        win.step();
        this.cover(target, placed);
        this.active = true;
      } catch (error) {
        if (modeChanged && win.live()) {
          try {
            await setDashboardInteractionMode(this.active);
          } catch (rollbackError) {
            console.warn('could not restore dashboard interaction mode', rollbackError);
          }
        }
        await win.rollbackTopmost(previousTopmost);
        throw error;
      }
    });
  }

  /** Moves the fullscreen window to another monitor; false when that monitor reports no usable rectangle. */
  async moveTo(target: MonitorGeometry) {
    const desired = monitorRect(target);
    if (!validGeometry(desired)) {
      return false;
    }
    await this.win.moving(async () => {
      this.win.step();
      await this.windowed.followMonitor(target);
      this.win.step();
      const placed = await this.win.placeIfDifferent(desired);
      this.win.step();
      this.cover(target, placed);
    });
    return true;
  }

  /** Covers the same monitor again, e.g. after its resolution changed. */
  async refit(target: MonitorGeometry) {
    this.cover(target, await this.win.placeIfDifferent(monitorRect(target)));
  }

  async exit(target: MonitorGeometry, alwaysOnTop: boolean) {
    const retained = this.windowed.normal;
    if (!retained) {
      throw new Error('No normal dashboard rectangle was retained');
    }
    const targetChanged = target.name !== this.windowed.monitor;
    const desired = clampGeometryToWorkArea(retained, target, targetChanged) ?? retained;
    const win = this.win;
    await win.moving(async () => {
      try {
        win.step();
        const placed = await win.placeIfDifferent(desired);
        win.step();
        await win.setTopmost(alwaysOnTop);
        await setDashboardInteractionMode(false);
        win.step();
        this.active = false;
        this.bounds = null;
        await this.windowed.saveQuietly(placed, target.name);
      } catch (error) {
        if (win.live()) {
          await this.restore();
        }
        throw error;
      }
    });
  }

  /** Puts the window back over `target` after the OS or a monitor change resized it. */
  async reconcile(target: MonitorGeometry) {
    const desired = monitorRect(target);
    if (!validGeometry(desired)) {
      return;
    }
    const actual = await this.win.readBounds();
    if (sameGeometry(actual, desired)) {
      this.cover(target, desired);
      return;
    }
    await this.win.moving(async () => {
      this.win.step();
      await this.windowed.followMonitor(target);
      this.win.step();
      const placed = await this.win.place(desired);
      this.win.step();
      this.cover(target, placed);
    });
  }

  private cover(target: MonitorGeometry, bounds: Geometry) {
    this.monitor = target.name;
    this.bounds = bounds;
  }

  /** Rollback for a failed exit: back to fullscreen interaction, topmost and the fullscreen rectangle. */
  private async restore() {
    try {
      await setDashboardInteractionMode(true);
    } catch (rollbackError) {
      console.warn('could not restore dashboard fullscreen mode', rollbackError);
    }
    await this.win.rollbackTopmost(true);
    try {
      if (this.bounds) {
        await this.win.placeIfDifferent(this.bounds);
      }
    } catch (rollbackError) {
      console.warn('could not restore dashboard fullscreen bounds', rollbackError);
    }
  }
}

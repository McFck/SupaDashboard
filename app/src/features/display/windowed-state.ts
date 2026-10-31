// The windowed (normal) dashboard rectangle: what fullscreen exit and the next start-up restore. It is written to
// window-state.json after the user moves or resizes the window and after every controller move of it.
import {
  connectedMonitors,
  setDashboardInteractionMode,
  type WindowStateStore,
} from '../../platform/window';
import type { Page } from '../settings/schema';
import { PhysicalSize } from '@tauri-apps/api/dpi';
import type { ControlledWindow } from './controlled-window';
import {
  clampGeometryToWorkArea,
  monitorWithLargestIntersection,
  sameGeometry,
  startupPlacement,
  minimumWindowSize,
  validGeometry,
} from './geometry';
import type { Geometry, MonitorGeometry } from './geometry';

const SAVE_DELAY_MS = 300;
/** window-state.json key: the remembered windowed rectangle per monitor name. */
const BY_MONITOR = 'dashboardByMonitor';

type StartupPlacement = Awaited<ReturnType<WindowedBounds['startupPlacement']>>;

export class WindowedBounds {
  selected: string | null = null;
  /** The windowed rectangle to restore on fullscreen exit, and the monitor it belongs to. */
  normal: Geometry | null = null;
  monitor: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private grid: Pick<Page, 'cols' | 'rows' | 'gap'> = { cols: 1, rows: 1, gap: 0 };
  private bottomInset = 0;

  constructor(
    private readonly win: ControlledWindow,
    private readonly store: WindowStateStore,
  ) {}

  configureMinimum(grid: Pick<Page, 'cols' | 'rows' | 'gap'>, bottomInset: number) {
    this.grid = { cols: grid.cols, rows: grid.rows, gap: grid.gap };
    this.bottomInset = bottomInset;
  }

  private minimum(target: MonitorGeometry | undefined, scale = 1) {
    const size = minimumWindowSize(this.grid, target?.scaleFactor ?? scale, this.bottomInset);
    // A deck larger than the monitor must still leave the whole window reachable.
    return target
      ? {
          width: Math.min(size.width, target.workArea.size.width),
          height: Math.min(size.height, target.workArea.size.height),
        }
      : size;
  }

  fit(bounds: Geometry, target: MonitorGeometry | undefined, center = false) {
    const minimum = this.minimum(target);
    const expanded = {
      ...bounds,
      width: Math.max(bounds.width, minimum.width),
      height: Math.max(bounds.height, minimum.height),
    };
    return target ? (clampGeometryToWorkArea(expanded, target, center) ?? expanded) : expanded;
  }

  async setNativeMinimum(target?: MonitorGeometry) {
    const minimum = this.minimum(target, await this.win.win.scaleFactor());
    await this.win.win.setMinSize(new PhysicalSize(minimum.width, minimum.height));
    this.win.step();
  }

  /** Grid and DPI changes can raise the minimum while an already-open window is small. */
  async enforceMinimum() {
    const snapshot = await connectedMonitors();
    const actual = await this.win.readBounds();
    this.win.step();
    const monitor =
      monitorWithLargestIntersection(actual, snapshot.screens) ?? snapshot.current ?? undefined;
    await this.win.moving(async () => {
      await this.setNativeMinimum(monitor);
      // A DPI change can happen mid-drag; grow at the latest position without clamping it to one monitor.
      const current = await this.win.readBounds();
      this.win.step();
      const minimum = this.minimum(monitor);
      const bounds = {
        ...current,
        width: Math.max(current.width, minimum.width),
        height: Math.max(current.height, minimum.height),
      };
      if (!sameGeometry(bounds, current)) {
        const placed = await this.win.place(bounds);
        this.win.step();
        if (sameGeometry(placed, bounds)) {
          await this.save(placed, monitor?.name ?? null);
        } else {
          this.keep(placed, monitor?.name ?? null);
        }
      }
    });
  }

  /** Where the window opens: the saved rectangle, or the deck's natural size, on the chosen monitor. */
  async startupPlacement(preferred: string | null, deck: Page) {
    const [{ screens, current, primary }, actual] = await Promise.all([
      connectedMonitors(),
      this.win.readBounds(),
    ]);
    const target = screens.find(
      (screen) => screen.name === preferred || screen.legacyName === preferred,
    );
    // Windows reuses GDI numbers; migrate an alias only while the saved selection still uses that alias.
    const saved = await this.remembered(
      target?.name ?? preferred,
      preferred === target?.legacyName ? target?.legacyName : undefined,
    );
    const placement = startupPlacement(screens, preferred, saved, primary, actual, deck);
    return {
      screens,
      current,
      ...placement,
      bounds: this.fit(placement.bounds, placement.monitor),
    };
  }

  /** Explicit monitors use their own entry; the global rectangle is only for automatic placement. */
  private async remembered(monitor: string | null, legacyName?: string) {
    const entries = await this.rememberedByMonitor();
    const byMonitor = monitor
      ? (entries[monitor] ?? (legacyName ? entries[legacyName] : undefined))
      : undefined;
    // A global rectangle may have been saved after Windows moved a disconnected window to DISPLAY1.
    return monitor ? byMonitor : await this.store.get<Geometry>('dashboard');
  }

  private async rememberedByMonitor() {
    const stored = await this.store.get<Record<string, Geometry>>(BY_MONITOR);
    const valid: Record<string, Geometry> = {};
    if (stored && typeof stored === 'object') {
      for (const [name, bounds] of Object.entries(stored)) {
        if (validGeometry(bounds)) {
          valid[name] = bounds;
        }
      }
    }
    return valid;
  }

  /** Applies the start-up rectangle in windowed mode; false when the controller went away meanwhile. */
  async restore({ screens, current, monitor: selected, bounds }: StartupPlacement) {
    return this.win.moving(async () => {
      await setDashboardInteractionMode(false);
      if (!this.win.live()) {
        return false;
      }
      await this.setNativeMinimum(selected);
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

  /** `dashboard` stays the last rectangle (the pre-per-monitor shape), so an older build still reads it. */
  async save(bounds: Geometry, monitor: string | null) {
    if (this.selected) {
      const { screens } = await connectedMonitors();
      const target = screens.find(
        (screen) => screen.name === this.selected || screen.legacyName === this.selected,
      );
      if (!target || monitorWithLargestIntersection(bounds, screens)?.name !== target.name) {
        return;
      }
      monitor = target.name;
    }
    if (monitor) {
      await this.store.set(BY_MONITOR, {
        ...(await this.rememberedByMonitor()),
        [monitor]: bounds,
      });
    }
    await this.store.set('dashboard', bounds);
    this.keep(bounds, monitor);
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
    const { screens, current } = await connectedMonitors();
    const monitor = monitorWithLargestIntersection(bounds, screens)?.name ?? current?.name ?? null;
    if (!this.normal || !sameGeometry(bounds, this.normal)) {
      await this.save(bounds, monitor);
    } else {
      this.keep(bounds, monitor);
    }
  }

  /** While fullscreen on another monitor, the retained windowed rectangle follows, centered on the new monitor. */
  async followMonitor(target: MonitorGeometry) {
    if (this.normal && target.name !== this.monitor) {
      await this.save(this.fit(this.normal, target, true), target.name);
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
        await this.setNativeMinimum(target);
        const current = await win.readBounds();
        win.step();
        const placed = await win.placeIfDifferent(this.fit(current, target, center));
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

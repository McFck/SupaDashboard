// The dashboard window's display controller: one per window. Every native change runs through its one queue, and
// it alone decides which display request still needs applying and reports the fullscreen outcome.
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow, type Window } from '@tauri-apps/api/window';
import type { Page } from '../settings/schema';
import {
  connectedMonitors,
  openWindowStateStore,
  type WindowStateStore,
} from '../../platform/window';
import { ControlledWindow } from './controlled-window';
import { Fullscreen } from './fullscreen';
import {
  chosenMonitorMissing,
  resolveLiveMonitor,
  type DisplayRequest,
  type MonitorGeometry,
} from './geometry';
import { WindowedBounds } from './windowed-state';
import { toast } from 'svelte-sonner';

const requestOf = (display: DisplayRequest): DisplayRequest => ({
  monitor: display.monitor,
  fullscreen: display.fullscreen,
  alwaysOnTop: display.alwaysOnTop,
});

const sameRequest = (a: DisplayRequest | null, b: DisplayRequest) =>
  !!a &&
  a.monitor === b.monitor &&
  a.fullscreen === b.fullscreen &&
  a.alwaysOnTop === b.alwaysOnTop;

/** How often a chosen monitor's connection is checked; Tauri reports no monitor change event. */
const MONITOR_POLL_MS = 1500;

let activeController: DisplayController | undefined;

async function resolveTarget(monitor: string | null) {
  const snapshot = await connectedMonitors();
  const target = chosenMonitorMissing(snapshot.screens, monitor)
    ? undefined
    : resolveLiveMonitor(snapshot.screens, monitor, snapshot.current, snapshot.primary);
  return { ...snapshot, target };
}

export class DisplayController {
  private readonly window: ControlledWindow;
  private readonly windowed: WindowedBounds;
  private readonly fullscreen: Fullscreen;
  private chain: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private reconcileQueued = false;
  private readonly listeners: (() => void)[] = [];
  private applied: DisplayRequest | null = null;
  private latest: DisplayRequest | null = null;
  private deck: Page | null = null;
  /** Hidden because the chosen monitor is not connected; nothing is moved or saved until it returns. */
  unavailable = false;

  constructor(
    private readonly win: Window,
    store: WindowStateStore,
    private readonly cancelled: () => boolean,
    private readonly onFullscreen: (fullscreen: boolean) => void,
  ) {
    this.window = new ControlledWindow(win, () => this.live());
    this.windowed = new WindowedBounds(this.window, store);
    this.fullscreen = new Fullscreen(this.window, this.windowed);
  }

  /** Applies requests in order; only a successful placement suppresses a later retry. */
  request(display: DisplayRequest) {
    const request = requestOf(display);
    this.latest = request;
    return this.serialize(async () => {
      if (sameRequest(this.applied, request)) {
        return;
      }
      try {
        const success = await this.apply(request);
        if (this.live()) {
          this.applied = success ? request : null;
          this.onFullscreen(this.fullscreen.active);
        }
      } catch (error) {
        this.applied = null;
        if (this.live()) {
          console.warn('display', error);
          toast.error('Could not configure dashboard window');
        }
      }
    });
  }

  updateGrid(deck: Page, bottomInset: number) {
    this.deck = deck;
    return this.serialize(async () => {
      this.windowed.configureMinimum(deck, bottomInset);
      if (!this.fullscreen.active) {
        await this.windowed.enforceMinimum();
      }
    }).catch(() => toast.error('Could not apply minimum window size'));
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.windowed.cancelSave();
    for (const unlisten of this.listeners.splice(0)) {
      unlisten();
    }
    if (activeController === this) {
      activeController = undefined;
    }
  }

  live() {
    return !this.disposed && !this.cancelled();
  }

  /** Places the window for the stored settings at start-up; false when the caller went away meanwhile. */
  async start(initial: DisplayRequest, deck: Page, bottomInset = 0) {
    this.windowed.configureMinimum(deck, bottomInset);
    this.deck = deck;
    this.latest = initial;
    this.window.topmost = await this.win.isAlwaysOnTop();
    this.window.step();
    const startup = await this.windowed.startupPlacement(initial.monitor, deck);
    if (this.abandoned()) {
      return false;
    }
    await this.listen();
    if (startup.missing) {
      this.unavailable = true;
      this.onFullscreen(false);
      return true;
    }
    if (this.abandoned() || !(await this.windowed.restore(startup)) || this.abandoned()) {
      return false;
    }

    if (initial.fullscreen && startup.monitor) {
      await this.fullscreen.enter(startup.monitor, startup.screens, startup.current);
    } else {
      await this.window.setTopmost(initial.alwaysOnTop);
    }
    if (this.abandoned()) {
      return false;
    }
    if (
      initial.fullscreen === this.fullscreen.active &&
      (!initial.monitor ||
        initial.monitor === startup.monitor?.name ||
        initial.monitor === startup.monitor?.legacyName)
    ) {
      this.applied = initial;
    }
    this.onFullscreen(this.fullscreen.active);
    return true;
  }

  /** Disposes the controller when the caller went away during an await. */
  private abandoned() {
    if (this.cancelled()) {
      this.dispose();
    }
    return this.cancelled();
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const result = this.chain.then(() => (this.live() ? operation() : undefined));
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Applies one display request. */
  private async apply(request: DisplayRequest) {
    const last = this.applied;
    if (last && request.monitor === last.monitor && request.fullscreen === last.fullscreen) {
      await this.window.setTopmost(this.fullscreen.active || request.alwaysOnTop);
      return true;
    }
    const { screens, current, target } = await resolveTarget(request.monitor);
    this.window.step();
    if (!target) {
      if (request.monitor) {
        await this.hide();
      } else {
        await this.window.setTopmost(this.fullscreen.active || request.alwaysOnTop);
      }
      return false;
    }

    if (this.unavailable && !this.fullscreen.active) {
      await this.reopen(request, target, screens, current);
    } else if (request.fullscreen) {
      if (!this.fullscreen.active) {
        await this.fullscreen.enter(target, screens, current);
      } else if (this.fullscreen.monitor !== target.name || request.monitor !== last?.monitor) {
        if (!(await this.fullscreen.moveTo(target))) {
          return false;
        }
      } else {
        await this.fullscreen.refit(target);
      }
    } else if (this.fullscreen.active) {
      await this.fullscreen.exit(target, request.alwaysOnTop);
    } else if (request.monitor !== last?.monitor) {
      const chosen =
        !!request.monitor &&
        (target.name === request.monitor || target.legacyName === request.monitor);
      await this.windowed.moveTo(target, chosen, request.alwaysOnTop);
    }
    await this.show();
    return (
      !request.monitor || target.name === request.monitor || target.legacyName === request.monitor
    );
  }

  /** The screen is back (or another one was chosen): open at its remembered rectangle, as at start-up. */
  private async reopen(
    request: DisplayRequest,
    target: MonitorGeometry,
    screens: MonitorGeometry[],
    current: MonitorGeometry | null,
  ) {
    if (!this.deck) {
      throw new Error('Dashboard grid is not configured');
    }
    await this.windowed.restore(await this.windowed.startupPlacement(request.monitor, this.deck));
    this.window.step();
    if (request.fullscreen) {
      await this.fullscreen.enter(target, screens, current);
    } else {
      await this.window.setTopmost(request.alwaysOnTop);
    }
  }

  private async hide() {
    if (!this.unavailable) {
      this.unavailable = true;
      await this.win.hide();
    }
    this.applied = null;
  }

  private async show() {
    if (this.unavailable) {
      await this.win.show();
      this.unavailable = false;
    }
  }

  private watchMonitor() {
    const timer = setInterval(() => void this.checkMonitor(), MONITOR_POLL_MS);
    this.listeners.push(() => clearInterval(timer));
  }

  /** Hides the window once its chosen monitor is gone and brings it back when that monitor returns. */
  private checkMonitor() {
    return this.serialize(async () => {
      const request = this.latest;
      if (!request?.monitor) {
        return;
      }
      const { screens } = await connectedMonitors();
      if (!this.live() || this.latest !== request) {
        return;
      }
      const missing = chosenMonitorMissing(screens, request.monitor);
      if (missing && !this.unavailable) {
        await this.hide();
      } else if (!missing && this.unavailable) {
        void this.request(request);
      }
    }).catch((error) => console.warn('display monitor', error));
  }

  private async listen() {
    const onResize = () => {
      this.saveUserBoundsLater();
      if (this.fullscreen.active) {
        this.queueReconcile();
      }
    };
    this.watchMonitor();
    this.listeners.push(await this.win.onMoved(() => this.saveUserBoundsLater()));
    this.listeners.push(await this.win.onResized(onResize));
    this.listeners.push(
      await this.win.onScaleChanged(() => {
        this.saveUserBoundsLater();
        this.queueReconcile();
      }),
    );
  }

  /** Only user moves and resizes of the windowed dashboard are saved. */
  private canSaveUserBounds() {
    return this.live() && !this.unavailable && !this.fullscreen.active && !this.window.transition;
  }

  private saveUserBoundsLater() {
    if (!this.canSaveUserBounds()) {
      return;
    }
    this.windowed.saveLater(() => {
      if (!this.canSaveUserBounds()) {
        return;
      }
      void this.serialize(async () => {
        if (!this.canSaveUserBounds()) {
          return;
        }
        const bounds = await this.window.readBounds();
        if (this.canSaveUserBounds()) {
          await this.windowed.recordUserBounds(bounds);
        }
      }).catch((error) => console.warn('window state', error));
    });
  }

  private queueReconcile() {
    if (!this.live() || this.window.transition || this.reconcileQueued) {
      return;
    }
    this.reconcileQueued = true;
    queueMicrotask(() => {
      this.reconcileQueued = false;
      void this.serialize(() => this.reconcile()).catch((error) => {
        console.warn('display reconcile', error);
        toast.error('Could not configure dashboard window');
      });
    });
  }

  /** Reapplies fullscreen coverage or the windowed minimum after a resize or DPI change. */
  private async reconcile() {
    if (this.window.transition) {
      return;
    }
    if (!this.fullscreen.active) {
      await this.windowed.enforceMinimum();
      return;
    }
    const { target } = await resolveTarget(this.applied?.monitor ?? null);
    if (target) {
      await this.fullscreen.reconcile(target);
    }
  }
}

/** Places the dashboard window at start-up and starts tracking it; resolves to null outside Tauri or when the caller
 *  went away meanwhile. `onFullscreen` hears whether the window is fullscreen after start-up and every request. */
export async function startDisplay(
  initial: DisplayRequest,
  deck: Page,
  cancelled: () => boolean,
  onFullscreen: (fullscreen: boolean) => void,
  bottomInset = 0,
): Promise<DisplayController | null> {
  if (!isTauri()) {
    return null;
  }
  activeController?.dispose();
  const store = await openWindowStateStore();
  const controller = new DisplayController(getCurrentWindow(), store, cancelled, onFullscreen);
  activeController = controller;
  try {
    return (await controller.start(requestOf(initial), deck, bottomInset)) ? controller : null;
  } catch (error) {
    controller.dispose();
    if (cancelled()) {
      return null;
    }
    throw error;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => activeController?.dispose());
}

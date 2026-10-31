import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Window } from '@tauri-apps/api/window';
import type { WindowStateStore } from '../../platform/window';
import type { Geometry, MonitorGeometry } from './geometry';
import { DisplayController } from './display';
import type { Page } from '../settings/schema';

type MonitorSnapshot = { screens: MonitorGeometry[]; current: null; primary: null };

const native = vi.hoisted(() => ({
  screens: [] as MonitorGeometry[],
  bounds: { x: 10, y: 10, width: 400, height: 300 } as Geometry,
  adjustment: 0,
  blocked: false,
  readMonitors: vi.fn<() => Promise<MonitorSnapshot>>(),
}));
vi.mock('../../platform/window', () => ({
  connectedMonitors: () => native.readMonitors(),
  readWindowBounds: async () => native.bounds,
  setDashboardBounds: async (bounds: Geometry) => {
    native.blocked = false;
    return (native.bounds = { ...bounds, width: bounds.width + native.adjustment });
  },
  setDashboardInteractionMode: async () => {},
  setDashboardMonitor: async () => false,
  dashboardMonitorBlocked: async () => native.blocked,
}));

let controller: DisplayController;
beforeEach(() => {
  native.adjustment = 0;
  native.blocked = false;
  native.readMonitors.mockReset();
  native.readMonitors.mockImplementation(async () => ({
    screens: native.screens,
    current: null,
    primary: null,
  }));
});
afterEach(() => controller?.dispose());

it.each(['absent', 'invalid'] as const)(
  'retries an unapplied fullscreen placement after a monitor was %s',
  async (failure) => {
    const screen = (name: string, x: number, width = 1920): MonitorGeometry => ({
      name,
      position: { x, y: 0 },
      size: { width, height: 1080 },
      workArea: { position: { x, y: 0 }, size: { width, height: 1040 } },
      scaleFactor: 1,
    });
    native.screens = [screen('first', 0)];
    native.bounds = { x: 10, y: 10, width: 400, height: 300 };
    const win = {
      isAlwaysOnTop: async () => false,
      setAlwaysOnTop: async () => {},
      setMinSize: async () => {},
      scaleFactor: async () => 1,
      onMoved: async () => () => {},
      onResized: async () => () => {},
      onScaleChanged: async () => () => {},
      hide: async () => {},
      show: async () => {},
    } as unknown as Window;
    const store = {
      get: async () => undefined,
      set: async () => {},
    } as unknown as WindowStateStore;
    controller = new DisplayController(
      win,
      store,
      () => false,
      () => {},
    );
    await controller.start({ monitor: null, fullscreen: true, alwaysOnTop: false }, {
      cols: 4,
      rows: 2,
      size: 80,
      gap: 8,
    } as Parameters<DisplayController['start']>[1]);
    native.screens = failure === 'absent' ? [] : [screen('second', 1920, 0)];
    const request = { monitor: 'second', fullscreen: true, alwaysOnTop: false };
    await controller.request(request);
    expect(native.bounds.x).toBe(0);
    native.screens = [screen('second', 1920)];
    await controller.request(request);
    expect(native.bounds).toEqual({ x: 1920, y: 0, width: 1920, height: 1080 });
  },
);

function windowFixture() {
  let scaleChanged = () => {};
  let moved = () => {};
  native.screens = [
    {
      name: 'screen',
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
      scaleFactor: 1.5,
    },
  ];
  const setMinSize = vi.fn(async () => {});
  const hide = vi.fn(async () => {});
  const show = vi.fn(async () => {});
  const win = {
    isAlwaysOnTop: async () => false,
    setAlwaysOnTop: async () => {},
    setMinSize,
    scaleFactor: async () => 1.5,
    onMoved: async (callback: () => void) => {
      moved = callback;
      return () => {};
    },
    onResized: async () => () => {},
    onScaleChanged: async (callback: () => void) => {
      scaleChanged = callback;
      return () => {};
    },
    hide,
    show,
  } as unknown as Window;
  const stored: Record<string, unknown> = {};
  const set = vi.fn(async (key: string, value: unknown) => {
    stored[key] = value;
  });
  const store = {
    get: async (key: string) =>
      key === 'dashboard' ? { x: 50, y: 50, width: 100, height: 100 } : stored[key],
    set,
  } as unknown as WindowStateStore;
  const deck = { cols: 6, rows: 3, size: 112, gap: 14 } as Page;
  controller = new DisplayController(
    win,
    store,
    () => false,
    () => {},
  );
  return {
    deck,
    win,
    store,
    set,
    setMinSize,
    hide,
    show,
    stored,
    scaleChanged: () => scaleChanged(),
    moved: () => moved(),
  };
}

it('enlarges a saved tiny window to the scaled grid minimum before persisting the restore', async () => {
  const { deck, set, setMinSize } = windowFixture();
  await controller.start({ monitor: null, fullscreen: false, alwaysOnTop: false }, deck, 34);
  expect(native.bounds).toEqual({ x: 50, y: 50, width: 579, height: 351 });
  expect(setMinSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 579, height: 351 }));
  expect(set).toHaveBeenLastCalledWith('dashboard', native.bounds);
});

it('restores legacy monitor bounds then keeps them under the device path after GDI renumbering', async () => {
  const { deck, win, store, stored } = windowFixture();
  const bounds = { x: 80, y: 90, width: 900, height: 600 };
  native.screens[0] = { ...native.screens[0], name: 'device-path', legacyName: 'DISPLAY17' };
  stored.dashboardByMonitor = { DISPLAY17: bounds };
  await controller.start({ monitor: 'DISPLAY17', fullscreen: false, alwaysOnTop: false }, deck);
  expect(native.bounds).toEqual(bounds);
  expect(stored.dashboardByMonitor).toEqual({ DISPLAY17: bounds, 'device-path': bounds });
  controller.dispose();
  native.screens[0] = { ...native.screens[0], legacyName: 'DISPLAY22' };
  controller = new DisplayController(
    win,
    store,
    () => false,
    () => {},
  );
  await controller.start({ monitor: 'device-path', fullscreen: false, alwaysOnTop: false }, deck);
  expect(native.bounds).toEqual(bounds);
});

it('does not persist a clamped restore that the OS applied differently', async () => {
  const { deck, set } = windowFixture();
  native.adjustment = 10;
  await controller.start({ monitor: null, fullscreen: false, alwaysOnTop: false }, deck);
  expect(native.bounds.width).toBe(589);
  expect(set).not.toHaveBeenCalled();
});

it('grows a small window after grid edits and restores the new minimum on fullscreen exit', async () => {
  const { deck, setMinSize } = windowFixture();
  const display = { monitor: null, fullscreen: false, alwaysOnTop: false };
  await controller.start(display, deck);
  await controller.updateGrid({ ...deck, cols: 10 }, 34);
  expect(native.bounds).toMatchObject({ width: 951, height: 351 });
  await controller.request({ ...display, fullscreen: true });
  expect(setMinSize).toHaveBeenLastCalledWith(null);
  await controller.updateGrid({ ...deck, cols: 12 }, 34);
  expect(native.bounds).toMatchObject({ width: 1920, height: 1080 });
  await controller.request(display);
  expect(native.bounds).toMatchObject({ width: 1137, height: 351 });
  expect(setMinSize).toHaveBeenLastCalledWith(
    expect.objectContaining({ width: 1137, height: 351 }),
  );
});

it('raises the window minimum when moving onto a higher DPI monitor', async () => {
  const { deck, scaleChanged, setMinSize } = windowFixture();
  await controller.start({ monitor: null, fullscreen: false, alwaysOnTop: false }, deck);
  native.screens[0].scaleFactor = 2;
  scaleChanged();
  await vi.waitFor(() => {
    expect(native.bounds).toMatchObject({ width: 772, height: 400 });
    expect(setMinSize).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 772, height: 400 }),
    );
  });
});

it.each([600, 1000])(
  'keeps a %ipx cross-monitor drag in place after a DPI change',
  async (width) => {
    const { deck, scaleChanged, set, setMinSize } = windowFixture();
    await controller.start({ monitor: null, fullscreen: false, alwaysOnTop: false }, deck);
    native.screens.push({
      ...native.screens[0],
      name: 'second',
      position: { x: 1920, y: 0 },
      workArea: { position: { x: 1920, y: 0 }, size: { width: 1920, height: 1040 } },
      scaleFactor: 2,
    });
    set.mockClear();
    native.bounds = { x: 1750, y: -30, width, height: 400 };
    scaleChanged();
    await vi.waitFor(() => {
      expect(native.bounds).toEqual({ x: 1750, y: -30, width: Math.max(width, 772), height: 400 });
      expect(setMinSize).toHaveBeenLastCalledWith(
        expect.objectContaining({ width: 772, height: 400 }),
      );
      if (width < 772) {
        expect(set).toHaveBeenLastCalledWith('dashboard', native.bounds);
      } else {
        expect(set).not.toHaveBeenCalled();
      }
    });
  },
);

const secondScreen = (x = 1920) => ({
  name: 'second',
  position: { x, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { position: { x, y: 0 }, size: { width: 1920, height: 1040 } },
  scaleFactor: 1.5,
});
const onSecond = { monitor: 'second', fullscreen: false, alwaysOnTop: false };

it('opens at the remembered rectangle of the chosen monitor when it is connected', async () => {
  const { deck, stored } = windowFixture();
  native.screens.push(secondScreen());
  stored.dashboardByMonitor = { second: { x: 2100, y: 60, width: 800, height: 500 } };
  await controller.start(onSecond, deck);
  expect(controller.unavailable).toBe(false);
  expect(native.bounds).toEqual({ x: 2100, y: 60, width: 800, height: 500 });
});

it('keeps the window hidden and unmoved while the chosen monitor is disconnected, then reopens it where it was', async () => {
  const { deck, set, hide, show, stored } = windowFixture();
  stored.dashboardByMonitor = { second: { x: 2100, y: 60, width: 800, height: 500 } };
  const before = { ...native.bounds };
  await controller.start(onSecond, deck);
  await controller.request(onSecond);
  expect(controller.unavailable).toBe(true);
  expect(native.bounds).toEqual(before);
  expect(set).not.toHaveBeenCalled();
  expect(show).not.toHaveBeenCalled();

  native.screens.push(secondScreen());
  await controller.request(onSecond);
  expect(controller.unavailable).toBe(false);
  expect(show).toHaveBeenCalledOnce();
  expect(hide).not.toHaveBeenCalled();
  expect(native.bounds).toEqual({ x: 2100, y: 60, width: 800, height: 500 });
});

it('hides, and never saves over the remembered rectangle, when the chosen monitor disappears while open', async () => {
  const { deck, hide, stored } = windowFixture();
  native.screens.push(secondScreen());
  stored.dashboardByMonitor = { second: { x: 2100, y: 60, width: 800, height: 500 } };
  vi.useFakeTimers();
  try {
    await controller.start(onSecond, deck);
    native.screens.splice(1);
    await vi.advanceTimersByTimeAsync(2000);
  } finally {
    vi.useRealTimers();
  }
  expect(hide).toHaveBeenCalledOnce();
  expect(controller.unavailable).toBe(true);
  expect(stored.dashboardByMonitor).toEqual({
    second: { x: 2100, y: 60, width: 800, height: 500 },
  });
});

it.each([false, true])(
  'rejects Windows relocation before the poll and restores remembered placement (fullscreen=%s)',
  async (fullscreen) => {
    const { deck, set, stored, moved, scaleChanged, show } = windowFixture();
    native.screens.push(secondScreen());
    const remembered = { x: 2100, y: 60, width: 800, height: 500 };
    stored.dashboardByMonitor = { second: remembered };
    vi.useFakeTimers();
    try {
      await controller.start({ ...onSecond, fullscreen }, deck);
      set.mockClear();
      native.screens.splice(1);
      native.bounds = { x: 10, y: 10, width: 800, height: 500 };
      moved();
      await vi.advanceTimersByTimeAsync(400);
      expect(set).not.toHaveBeenCalled();
      scaleChanged();
      await controller.updateGrid(deck, 0);
      expect(native.bounds).toEqual({ x: 10, y: 10, width: 800, height: 500 });
      expect(set).not.toHaveBeenCalled();
      expect(stored.dashboardByMonitor).toEqual({ second: remembered });
      await vi.advanceTimersByTimeAsync(1200);
      expect(controller.unavailable).toBe(true);
      native.screens.push(secondScreen());
      await vi.advanceTimersByTimeAsync(1600);
      expect(show).toHaveBeenCalledOnce();
      expect(native.bounds).toEqual(
        fullscreen ? { x: 1920, y: 0, width: 1920, height: 1080 } : remembered,
      );
      expect(stored.dashboardByMonitor).toEqual({ second: remembered });
    } finally {
      vi.useRealTimers();
    }
  },
);

it('restores after a native hide even when the monitor returns between availability polls', async () => {
  const { deck, stored, moved, set, show } = windowFixture();
  native.screens.push(secondScreen());
  const remembered = { x: 2100, y: 60, width: 800, height: 500 };
  stored.dashboardByMonitor = { second: remembered };
  vi.useFakeTimers();
  try {
    await controller.start(onSecond, deck);
    set.mockClear();
    native.bounds = { x: 10, y: 10, width: 800, height: 500 };
    native.blocked = true;
    moved();
    await vi.advanceTimersByTimeAsync(400);
    expect(set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1200);
    expect(native.bounds).toEqual(remembered);
    expect(show).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it('ignores a polluted global placement when the chosen monitor has no saved placement', async () => {
  const { deck, stored } = windowFixture();
  native.screens.push(secondScreen());
  stored.dashboardByMonitor = { screen: { x: 10, y: 10, width: 900, height: 700 } };
  await controller.start(onSecond, deck);
  expect(native.bounds.x).toBeGreaterThanOrEqual(1920);
  expect(native.bounds.width).toBeGreaterThan(579);
});

it('moves to another monitor only after an explicit selection', async () => {
  const { deck } = windowFixture();
  native.screens.push(secondScreen());
  await controller.start(onSecond, deck);
  await controller.request({ ...onSecond, monitor: 'screen' });
  expect(native.bounds.x).toBeLessThan(1920);
});

it('does not hide a newly selected connected display when an old monitor check finishes', async () => {
  const { deck, hide, show } = windowFixture();
  vi.useFakeTimers();
  try {
    await controller.start({ monitor: 'screen', fullscreen: true, alwaysOnTop: false }, deck);
    let finish = (_snapshot: MonitorSnapshot): void => {
      throw new Error('Monitor query did not start');
    };
    native.readMonitors.mockReturnValueOnce(
      new Promise<MonitorSnapshot>((resolve) => {
        finish = resolve;
      }),
    );
    await vi.advanceTimersByTimeAsync(1500);
    native.screens = [secondScreen()];
    const moved = controller.request({ ...onSecond, fullscreen: true });
    finish({ screens: [], current: null, primary: null });
    await moved;
    await vi.advanceTimersByTimeAsync(0);
    expect(hide).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    expect(controller.unavailable).toBe(false);
    expect(native.bounds).toEqual({ x: 1920, y: 0, width: 1920, height: 1080 });
  } finally {
    controller.dispose();
    vi.useRealTimers();
  }
});

it('does not reopen an old display after the user selected a different connected display', async () => {
  const { deck, hide, show } = windowFixture();
  vi.useFakeTimers();
  try {
    await controller.start(onSecond, deck);
    let finish = (_snapshot: MonitorSnapshot): void => {
      throw new Error('Monitor query did not start');
    };
    native.readMonitors.mockReturnValueOnce(
      new Promise<MonitorSnapshot>((resolve) => {
        finish = resolve;
      }),
    );
    await vi.advanceTimersByTimeAsync(1500);
    const moved = controller.request({ ...onSecond, monitor: 'screen' });
    finish({ screens: [secondScreen()], current: null, primary: null });
    await moved;
    await vi.advanceTimersByTimeAsync(0);
    expect(hide).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledOnce();
    expect(controller.unavailable).toBe(false);
    expect(native.bounds.x).toBeLessThan(1920);
  } finally {
    controller.dispose();
    vi.useRealTimers();
  }
});

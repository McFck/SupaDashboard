import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Window } from '@tauri-apps/api/window';
import type { WindowStateStore } from '../../platform/window';
import type { Geometry, MonitorGeometry } from './geometry';
import { DisplayController } from './display';
import type { Page } from '../settings/schema';

const native = vi.hoisted(() => ({
  screens: [] as MonitorGeometry[],
  bounds: { x: 10, y: 10, width: 400, height: 300 } as Geometry,
  adjustment: 0,
}));
vi.mock('../../platform/window', () => ({
  connectedMonitors: async () => ({ screens: native.screens, current: null, primary: null }),
  readWindowBounds: async () => native.bounds,
  setDashboardBounds: async (bounds: Geometry) =>
    (native.bounds = { ...bounds, width: bounds.width + native.adjustment }),
  setDashboardInteractionMode: async () => {},
}));

let controller: DisplayController;
beforeEach(() => {
  native.adjustment = 0;
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
  const win = {
    isAlwaysOnTop: async () => false,
    setAlwaysOnTop: async () => {},
    setMinSize,
    scaleFactor: async () => 1.5,
    onMoved: async () => () => {},
    onResized: async () => () => {},
    onScaleChanged: async (callback: () => void) => {
      scaleChanged = callback;
      return () => {};
    },
  } as unknown as Window;
  const set = vi.fn(async () => {});
  const store = {
    get: async () => ({ x: 50, y: 50, width: 100, height: 100 }),
    set,
  } as unknown as WindowStateStore;
  const deck = { cols: 6, rows: 3, size: 112, gap: 14 } as Page;
  controller = new DisplayController(
    win,
    store,
    () => false,
    () => {},
  );
  return { deck, set, setMinSize, scaleChanged: () => scaleChanged() };
}

it('enlarges a saved tiny window to the scaled grid minimum before persisting the restore', async () => {
  const { deck, set, setMinSize } = windowFixture();
  await controller.start({ monitor: null, fullscreen: false, alwaysOnTop: false }, deck, 34);
  expect(native.bounds).toEqual({ x: 50, y: 50, width: 579, height: 351 });
  expect(setMinSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 579, height: 351 }));
  expect(set).toHaveBeenLastCalledWith('dashboard', native.bounds);
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

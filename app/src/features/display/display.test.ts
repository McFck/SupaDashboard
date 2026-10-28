import { afterEach, expect, it, vi } from 'vitest';
import type { Window } from '@tauri-apps/api/window';
import type { WindowStateStore } from '../../platform/window';
import type { Geometry, MonitorGeometry } from './geometry';
import { DisplayController } from './display';

const native = vi.hoisted(() => ({
  screens: [] as MonitorGeometry[],
  bounds: { x: 10, y: 10, width: 400, height: 300 } as Geometry,
}));
vi.mock('../../platform/window', () => ({
  connectedMonitors: async () => ({ screens: native.screens, current: null, primary: null }),
  readWindowBounds: async () => native.bounds,
  setDashboardBounds: async (bounds: Geometry) => (native.bounds = bounds),
  setDashboardInteractionMode: async () => {},
}));

let controller: DisplayController;
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

// Concrete Tauri window, monitor and window-state store I/O for the dashboard window. Nothing runs on import.
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import {
  availableMonitors,
  currentMonitor,
  primaryMonitor,
  type Window,
} from '@tauri-apps/api/window';
import type { Geometry, MonitorGeometry } from '../features/display/geometry';
import { buildMonitorOptions } from '../features/display/monitor-options';

export type WindowStateStore = Awaited<ReturnType<typeof load>>;

export const monitors = () => availableMonitors();

export async function connectedMonitors() {
  const [screens, current, primary, metadata] = await Promise.all([
    availableMonitors() as Promise<MonitorGeometry[]>,
    currentMonitor() as Promise<MonitorGeometry | null>,
    primaryMonitor() as Promise<MonitorGeometry | null>,
    invoke<unknown>('monitor_names').catch((error: unknown) => {
      // GDI names remain usable when Windows cannot report DisplayConfig metadata.
      console.warn('Monitor identity unavailable', error);
      return [];
    }),
  ]);
  const options = buildMonitorOptions(screens, Array.isArray(metadata) ? metadata : []);
  const identify = (monitor: MonitorGeometry): MonitorGeometry => ({
    ...monitor,
    legacyName: monitor.name,
    name: options.find((option) => option.legacyName === monitor.name)?.value ?? monitor.name,
  });
  return {
    screens: screens.map(identify),
    current: current && identify(current),
    primary: primary && identify(primary),
  };
}

export async function readWindowBounds(win: Window): Promise<Geometry> {
  const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
  return { x: position.x, y: position.y, width: size.width, height: size.height };
}

/** Returns the rectangle the OS actually applied, which may differ from the request. */
export const setDashboardBounds = (bounds: Geometry) =>
  invoke<Geometry>('dashboard_set_bounds', { bounds });

export const setDashboardInteractionMode = (fullscreen: boolean) =>
  invoke<void>('dashboard_interaction_mode', { fullscreen });

export const setDashboardBackdrop = (wallpaper: boolean, radius: number) =>
  invoke<void>('dashboard_backdrop', { wallpaper, radius });

export const startTouchWindowAction = (
  action: 'Move' | Parameters<Window['startResizeDragging']>[0],
) =>
  invoke<void>('dashboard_touch_window_action', {
    action: action === 'Move' ? 'Move' : { Resize: action },
  });

export const openWindowStateStore = () =>
  load('window-state.json', { defaults: {}, autoSave: 200 });

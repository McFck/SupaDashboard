// Concrete Tauri window, monitor and window-state store I/O for the dashboard window. Nothing runs on import.
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import {
  availableMonitors,
  currentMonitor,
  primaryMonitor,
  type Window,
} from '@tauri-apps/api/window';

/** Physical pixels, as Tauri reports outer window and monitor rectangles. */
export type Geometry = { x: number; y: number; width: number; height: number };
export type MonitorGeometry = {
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
  scaleFactor: number;
};
export type WindowStateStore = Awaited<ReturnType<typeof load>>;

export const monitors = () => availableMonitors();

export async function connectedMonitors() {
  const [screens, current, primary] = await Promise.all([
    availableMonitors() as Promise<MonitorGeometry[]>,
    currentMonitor() as Promise<MonitorGeometry | null>,
    primaryMonitor() as Promise<MonitorGeometry | null>,
  ]);
  return { screens, current, primary };
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

export const openWindowStateStore = () =>
  load('window-state.json', { defaults: {}, autoSave: 200 });

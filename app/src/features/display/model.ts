// Display contracts in physical pixels, shared by placement policy, the display controller and the Tauri adapter.
import type { Settings } from '../settings/schema';

/** Physical pixels, as Tauri reports outer window and monitor rectangles. */
export type Geometry = { x: number; y: number; width: number; height: number };
export type MonitorGeometry = {
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
  scaleFactor: number;
};

export type DisplayRequest = Pick<Settings['display'], 'monitor' | 'fullscreen' | 'alwaysOnTop'>;

export const requestOf = (display: DisplayRequest): DisplayRequest => ({
  monitor: display.monitor,
  fullscreen: display.fullscreen,
  alwaysOnTop: display.alwaysOnTop,
});

export const sameRequest = (a: DisplayRequest | null, b: DisplayRequest) =>
  !!a &&
  a.monitor === b.monitor &&
  a.fullscreen === b.fullscreen &&
  a.alwaysOnTop === b.alwaysOnTop;

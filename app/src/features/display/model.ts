// Display contracts in physical pixels, shared by placement policy, the display controller and the Tauri adapter.
/** Physical pixels, as Tauri reports outer window and monitor rectangles. */
export type Geometry = { x: number; y: number; width: number; height: number };
export type MonitorGeometry = {
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
  scaleFactor: number;
};

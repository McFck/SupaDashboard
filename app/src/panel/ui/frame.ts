export const SIDEBAR_RAIL = 56;
const INSPECTOR_MIN = 320;
const INSPECTOR_MAX = 640;

export function inspectorWidth(width: number) {
  return Math.round(Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, width)));
}

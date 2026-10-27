export const SIDEBAR_RAIL = 56;
const SIDEBAR_MIN = 192;
const SIDEBAR_MAX = 320;
/** Dragging the sidebar narrower than this collapses it to the icon rail. */
const SIDEBAR_COLLAPSE = 152;
const INSPECTOR_MIN = 320;
const INSPECTOR_MAX = 640;

export function sidebarWidth(width: number) {
  if (width < SIDEBAR_COLLAPSE) {
    return SIDEBAR_RAIL;
  }
  return Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, width)));
}

export function inspectorWidth(width: number) {
  return Math.round(Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, width)));
}

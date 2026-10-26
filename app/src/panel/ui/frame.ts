export const SIDEBAR_RAIL = 56;
export const SIDEBAR_MIN = 192;
export const SIDEBAR_MAX = 320;
export function sidebarWidth(width: number) {
  return width < 152
    ? SIDEBAR_RAIL
    : Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, width)));
}

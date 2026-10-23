import { sidebarWidth } from './frame';

function read() {
  try { return JSON.parse(localStorage.getItem('panel-frame') ?? '{}'); } catch { return {}; }
}
const saved = read();
export const frame = $state({
  sidebarWidth: typeof saved?.sidebarWidth === 'number' ? sidebarWidth(saved.sidebarWidth) : saved?.collapsed === true ? 64 : 240,
  inspectorOpen: saved?.inspectorOpen !== false,
  inspectorWidth: typeof saved?.inspectorWidth === 'number' ? Math.max(320, Math.min(640, saved.inspectorWidth)) : 400,
});
export function saveFrame() {
  try { localStorage.setItem('panel-frame', JSON.stringify(frame)); } catch { /* Storage can be unavailable in previews. */ }
}

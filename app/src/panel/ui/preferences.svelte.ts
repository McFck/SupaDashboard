import { inspectorWidth } from './frame';

function load(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {
    return {};
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage can be unavailable in previews. */
  }
}
const saved = load('panel-frame');
export const frame = $state({
  inspectorWidth:
    typeof saved?.inspectorWidth === 'number' ? inspectorWidth(saved.inspectorWidth) : 400,
});
export function saveFrame() {
  store('panel-frame', frame);
}

const savedPreview = load('layout-preview');
export const layoutPreview = $state({
  views:
    savedPreview?.views &&
    typeof savedPreview.views === 'object' &&
    !Array.isArray(savedPreview.views)
      ? ({ ...savedPreview.views } as Record<string, string>)
      : ({} as Record<string, string>),
});
export function saveLayoutPreview() {
  store('layout-preview', { views: layoutPreview.views });
}

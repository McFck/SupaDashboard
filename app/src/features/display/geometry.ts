// Pure dashboard window geometry and placement policy: monitor choice, work-area clamping, first-launch size.
import type { Page } from '../settings/schema';
import type { Geometry, MonitorGeometry } from '../../platform/window';

export type LocalRect = { x: number; y: number; width: number; height: number };

const I32_MAX = 2_147_483_647;
const I32_MIN = -2_147_483_648;

export const deckSize = (deck: Pick<Page, 'cols' | 'rows' | 'size' | 'gap'>) => ({
  width: deck.cols * deck.size + (deck.cols + 1) * deck.gap,
  height: deck.rows * deck.size + (deck.rows + 1) * deck.gap,
});

export function complementRectangles(
  width: number,
  height: number,
  excluded: LocalRect[],
  dpr: number,
  inset = 6,
): LocalRect[] {
  if (
    ![width, height, dpr, inset].every(Number.isFinite) ||
    width <= inset * 2 ||
    height <= inset * 2 ||
    dpr <= 0 ||
    inset < 0
  )
    return [];

  const left = inset,
    top = inset,
    right = width - inset,
    bottom = height - inset;
  const exclusions = excluded.flatMap((rect) => {
    if (
      ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0
    )
      return [];
    const rawRight = rect.x + rect.width,
      rawBottom = rect.y + rect.height;
    if (!Number.isFinite(rawRight) || !Number.isFinite(rawBottom)) return [];
    const x = Math.max(left, Math.min(right, Math.floor(rect.x * dpr) / dpr));
    const y = Math.max(top, Math.min(bottom, Math.floor(rect.y * dpr) / dpr));
    const x2 = Math.max(left, Math.min(right, Math.ceil(rawRight * dpr) / dpr));
    const y2 = Math.max(top, Math.min(bottom, Math.ceil(rawBottom * dpr) / dpr));
    return x2 > x && y2 > y ? [{ x, y, right: x2, bottom: y2 }] : [];
  });
  const xs = [
    ...new Set([left, right, ...exclusions.flatMap((rect) => [rect.x, rect.right])]),
  ].sort((a, b) => a - b);
  const result: LocalRect[] = [];
  let previousBands = new Map<string, number>();

  for (let i = 0; i < xs.length - 1; i++) {
    const x = xs[i],
      x2 = xs[i + 1];
    if (x2 <= x) continue;
    const intervals = exclusions
      .filter((rect) => rect.x < x2 && rect.right > x)
      .map((rect) => ({ top: rect.y, bottom: rect.bottom }))
      .sort((a, b) => a.top - b.top || a.bottom - b.bottom);
    const gaps: Array<{ top: number; bottom: number }> = [];
    let cursor = top;
    for (const interval of intervals) {
      if (interval.top > cursor) gaps.push({ top: cursor, bottom: interval.top });
      cursor = Math.max(cursor, interval.bottom);
    }
    if (cursor < bottom) gaps.push({ top: cursor, bottom });

    const bands = new Map<string, number>();
    for (const gap of gaps) {
      if (gap.bottom <= gap.top) continue;
      const key = `${gap.top}:${gap.bottom}`;
      const previous = previousBands.get(key);
      if (previous !== undefined && result[previous].x + result[previous].width === x) {
        result[previous].width += x2 - x;
        bands.set(key, previous);
      } else {
        bands.set(
          key,
          result.push({ x, y: gap.top, width: x2 - x, height: gap.bottom - gap.top }) - 1,
        );
      }
    }
    previousBands = bands;
  }
  return result;
}

export const validGeometry = (g: Geometry | null | undefined): g is Geometry =>
  !!g &&
  [g.x, g.y, g.width, g.height].every(Number.isSafeInteger) &&
  g.x >= I32_MIN &&
  g.x <= I32_MAX &&
  g.y >= I32_MIN &&
  g.y <= I32_MAX &&
  g.width > 0 &&
  g.width <= I32_MAX &&
  g.height > 0 &&
  g.height <= I32_MAX;

function intersectionArea(geometry: Geometry, monitor: Pick<MonitorGeometry, 'position' | 'size'>) {
  const width = Math.max(
    0,
    Math.min(geometry.x + geometry.width, monitor.position.x + monitor.size.width) -
      Math.max(geometry.x, monitor.position.x),
  );
  const height = Math.max(
    0,
    Math.min(geometry.y + geometry.height, monitor.position.y + monitor.size.height) -
      Math.max(geometry.y, monitor.position.y),
  );
  return width * height;
}

export function monitorWithLargestIntersection<
  T extends Pick<MonitorGeometry, 'name' | 'position' | 'size'>,
>(geometry: Geometry, screens: T[]): T | undefined {
  let best: T | undefined;
  let bestArea = 0;
  for (const screen of screens) {
    const area = intersectionArea(geometry, screen);
    if (area > bestArea) {
      best = screen;
      bestArea = area;
    }
  }
  return best;
}

export function resolveStartupMonitor<
  T extends Pick<MonitorGeometry, 'name' | 'position' | 'size'>,
>(
  screens: T[],
  preferred: string | null,
  saved: Geometry | null,
  primary: T | null,
): T | undefined {
  if (preferred) {
    const selected = screens.find((screen) => screen.name === preferred);
    if (selected) return selected;
  }
  if (saved && validGeometry(saved)) {
    const overlap = monitorWithLargestIntersection(saved, screens);
    if (overlap) return overlap;
  }
  return (primary && screens.find((screen) => screen.name === primary.name)) ?? screens[0];
}

export function resolveLiveMonitor<T extends Pick<MonitorGeometry, 'name'>>(
  screens: T[],
  preferred: string | null,
  current: T | null,
  primary: T | null,
): T | undefined {
  const explicit = preferred ? screens.find((screen) => screen.name === preferred) : undefined;
  const currentScreen = current
    ? screens.find((screen) => screen.name === current.name)
    : undefined;
  const primaryScreen = primary
    ? screens.find((screen) => screen.name === primary.name)
    : undefined;
  return explicit ?? currentScreen ?? primaryScreen ?? screens[0];
}

function workAreaOf(monitor: MonitorGeometry) {
  const { position, size } = monitor.workArea;
  const width = Math.floor(size.width);
  const height = Math.floor(size.height);
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || width < 1 || height < 1)
    return null;
  return { x: Math.ceil(position.x), y: Math.ceil(position.y), width, height };
}

export function clampGeometryToWorkArea(
  geometry: Geometry,
  monitor: MonitorGeometry,
  center = false,
): Geometry | null {
  const area = workAreaOf(monitor);
  if (!area) return null;
  const width = Math.max(1, Math.min(Math.floor(geometry.width), area.width));
  const height = Math.max(1, Math.min(Math.floor(geometry.height), area.height));
  const x = center
    ? area.x + Math.round((area.width - width) / 2)
    : Math.max(area.x, Math.min(Math.floor(geometry.x), area.x + area.width - width));
  const y = center
    ? area.y + Math.round((area.height - height) / 2)
    : Math.max(area.y, Math.min(Math.floor(geometry.y), area.y + area.height - height));
  const result = { x, y, width, height };
  return validGeometry(result) ? result : null;
}

export function firstLaunchGeometry(
  deck: Pick<Page, 'cols' | 'rows' | 'size' | 'gap'>,
  monitor: MonitorGeometry,
): Geometry | null {
  const area = workAreaOf(monitor);
  if (!area) return null;
  const natural = deckSize(deck);
  const scale =
    Number.isFinite(monitor.scaleFactor) && monitor.scaleFactor > 0 ? monitor.scaleFactor : 1;
  const naturalWidth = Math.max(1, Math.round(natural.width * scale));
  const naturalHeight = Math.max(1, Math.round(natural.height * scale));
  const factor = Math.min(1, area.width / naturalWidth, area.height / naturalHeight);
  const width = Math.max(1, Math.floor(naturalWidth * factor));
  const height = Math.max(1, Math.floor(naturalHeight * factor));
  return clampGeometryToWorkArea({ x: area.x, y: area.y, width, height }, monitor, true);
}

export const sameGeometry = (a: Geometry, b: Geometry) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const rect = (
  position: { x: number; y: number },
  size: { width: number; height: number },
): Geometry => ({ x: position.x, y: position.y, width: size.width, height: size.height });
export const monitorRect = (monitor: MonitorGeometry): Geometry =>
  rect(monitor.position, monitor.size);

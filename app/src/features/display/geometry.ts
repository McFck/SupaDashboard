// Pure dashboard window geometry and placement policy: monitor choice, work-area clamping, first-launch size.
import type { Page, Settings } from '../settings/schema';

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

const I32_MAX = 2_147_483_647;
const I32_MIN = -2_147_483_648;

const deckSize = (deck: Pick<Page, 'cols' | 'rows' | 'size' | 'gap'>) => ({
  width: deck.cols * deck.size + (deck.cols + 1) * deck.gap,
  height: deck.rows * deck.size + (deck.rows + 1) * deck.gap,
});

/** 48 CSS pixels per rendered cell; gap also supplies the deck's outer padding. */
export function minimumWindowSize(
  deck: Pick<Page, 'cols' | 'rows' | 'gap'>,
  scale: number,
  bottomInset = 0,
) {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    width: Math.ceil((deck.cols * 48 + (deck.cols + 1) * deck.gap) * factor),
    height: Math.ceil((deck.rows * 48 + (deck.rows + 1) * deck.gap + bottomInset) * factor),
  };
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

/** The chosen monitor is not connected: the dashboard stays hidden instead of moving to another display. */
export const chosenMonitorMissing = (
  screens: readonly { name: string }[],
  preferred: string | null,
) => !!preferred && !screens.some((screen) => screen.name === preferred);

/** Monitor for a live display change: the explicit choice, else wherever the window is now, else the primary. */
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
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || width < 1 || height < 1) {
    return null;
  }
  return { x: Math.ceil(position.x), y: Math.ceil(position.y), width, height };
}

/** Fits `geometry` inside the monitor's work area, keeping its position unless `center` is set. */
export function clampGeometryToWorkArea(
  geometry: Geometry,
  monitor: MonitorGeometry,
  center = false,
): Geometry | null {
  const area = workAreaOf(monitor);
  if (!area) {
    return null;
  }
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

/** The deck's natural size in physical pixels, shrunk to fit and centered in the work area. */
function firstLaunchGeometry(
  deck: Pick<Page, 'cols' | 'rows' | 'size' | 'gap'>,
  monitor: MonitorGeometry,
): Geometry | null {
  const area = workAreaOf(monitor);
  if (!area) {
    return null;
  }
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

const FALLBACK_BOUNDS: Geometry = { x: 0, y: 0, width: 770, height: 392 };

/**
 * Where the dashboard window opens. The monitor is the explicit choice, else the one the saved bounds mostly
 * cover, else the primary. Saved bounds are clamped into that monitor's work area, and centered on it when the
 * explicit choice differs from where they were saved; without saved bounds the deck's natural size is used.
 * A chosen monitor that is not connected yields no monitor and `missing`.
 */
export function startupPlacement(
  screens: MonitorGeometry[],
  preferred: string | null,
  saved: Geometry | undefined,
  primary: MonitorGeometry | null,
  actual: Geometry,
  deck: Pick<Page, 'cols' | 'rows' | 'size' | 'gap'>,
): { monitor: MonitorGeometry | undefined; bounds: Geometry; missing: boolean } {
  if (chosenMonitorMissing(screens, preferred)) {
    return { monitor: undefined, bounds: actual, missing: true };
  }
  const savedBounds = validGeometry(saved) ? saved : null;
  const monitor = resolveLiveMonitor(
    screens,
    preferred,
    savedBounds ? (monitorWithLargestIntersection(savedBounds, screens) ?? null) : null,
    primary,
  );
  let bounds: Geometry | null;
  if (!monitor) {
    bounds = actual;
  } else if (savedBounds) {
    const savedMonitor = monitorWithLargestIntersection(savedBounds, screens);
    const explicitChanged =
      !!preferred && monitor.name === preferred && savedMonitor?.name !== monitor.name;
    bounds = clampGeometryToWorkArea(savedBounds, monitor, explicitChanged) ?? actual;
  } else {
    bounds = firstLaunchGeometry(deck, monitor) ?? actual;
  }
  return { monitor, bounds: validGeometry(bounds) ? bounds : FALLBACK_BOUNDS, missing: false };
}

export const sameGeometry = (a: Geometry, b: Geometry) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export const monitorRect = (monitor: MonitorGeometry): Geometry => ({
  x: monitor.position.x,
  y: monitor.position.y,
  width: monitor.size.width,
  height: monitor.size.height,
});

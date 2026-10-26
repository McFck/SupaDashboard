import { invoke, isTauri } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import {
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  primaryMonitor,
} from '@tauri-apps/api/window';
import type { Page, Settings } from '../settings/schema';

export type Geometry = { x: number; y: number; width: number; height: number };
export type LocalRect = { x: number; y: number; width: number; height: number };
export type MonitorGeometry = {
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
  scaleFactor: number;
};
type DisplayRequest = Pick<Settings['display'], 'monitor' | 'fullscreen' | 'alwaysOnTop'>;
type Controller = {
  win: ReturnType<typeof getCurrentWindow>;
  store: Awaited<ReturnType<typeof load>>;
  cancelled: () => boolean;
  chain: Promise<unknown>;
  disposed: boolean;
  transition: boolean;
  appliedFullscreen: boolean;
  appliedTopmost: boolean;
  appliedMonitor: string | null;
  lastRequest: DisplayRequest;
  normal: Geometry | null;
  normalMonitor: string | null;
  fullBounds: Geometry | null;
  timer?: ReturnType<typeof setTimeout>;
  listeners: Array<() => void>;
  reconcileQueued: boolean;
};

const I32_MAX = 2_147_483_647;
const I32_MIN = -2_147_483_648;
let activeController: Controller | undefined;

export const monitors = () => availableMonitors();

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

export function intersectionArea(
  geometry: Geometry,
  monitor: Pick<MonitorGeometry, 'position' | 'size'>,
) {
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

const sameGeometry = (a: Geometry, b: Geometry) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const rect = (
  position: { x: number; y: number },
  size: { width: number; height: number },
): Geometry => ({ x: position.x, y: position.y, width: size.width, height: size.height });
const monitorRect = (monitor: MonitorGeometry): Geometry => rect(monitor.position, monitor.size);
const snapshotRequest = (display: DisplayRequest): DisplayRequest => ({
  monitor: display.monitor,
  fullscreen: display.fullscreen,
  alwaysOnTop: display.alwaysOnTop,
});
const monitorList = async () => (await availableMonitors()) as MonitorGeometry[];

async function readCurrentBounds(controller: Controller): Promise<Geometry> {
  const [position, size] = await Promise.all([
    controller.win.outerPosition(),
    controller.win.outerSize(),
  ]);
  return rect(position, size);
}

async function placeBounds(bounds: Geometry): Promise<Geometry> {
  if (!validGeometry(bounds)) throw new Error('Refusing invalid dashboard bounds');
  return invoke<Geometry>('dashboard_set_bounds', { bounds });
}

async function setInteractionMode(fullscreen: boolean) {
  await invoke<void>('dashboard_interaction_mode', { fullscreen });
}

async function placeIfDifferent(controller: Controller, desired: Geometry): Promise<Geometry> {
  if (!validGeometry(desired)) throw new Error('Monitor returned invalid dashboard bounds');
  const actual = await readCurrentBounds(controller);
  return sameGeometry(actual, desired) ? actual : placeBounds(desired);
}

function ensureActive(controller: Controller) {
  if (controller.disposed || controller.cancelled())
    throw new Error('Dashboard display controller disposed');
}

async function setEffectiveTopmost(controller: Controller, topmost: boolean) {
  if (controller.appliedTopmost === topmost) return;
  await controller.win.setAlwaysOnTop(topmost);
  ensureActive(controller);
  controller.appliedTopmost = topmost;
}

function serialize<T>(controller: Controller, operation: () => Promise<T>): Promise<T | undefined> {
  const result = controller.chain.then(() => {
    if (controller.disposed || controller.cancelled()) return undefined;
    return operation();
  });
  controller.chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function connectedMonitors() {
  const [screens, current, primary] = await Promise.all([
    monitorList(),
    currentMonitor() as Promise<MonitorGeometry | null>,
    primaryMonitor() as Promise<MonitorGeometry | null>,
  ]);
  return { screens, current, primary };
}

async function resolveTarget(request: DisplayRequest) {
  const snapshot = await connectedMonitors();
  const target = resolveLiveMonitor(
    snapshot.screens,
    request.monitor,
    snapshot.current,
    snapshot.primary,
  );
  return { ...snapshot, target };
}

async function persistNormal(controller: Controller, geometry: Geometry) {
  await controller.store.set('dashboard', geometry);
}

function saveNormalLater(controller: Controller) {
  if (
    controller.disposed ||
    controller.cancelled() ||
    controller.appliedFullscreen ||
    controller.transition
  )
    return;
  clearTimeout(controller.timer);
  controller.timer = setTimeout(() => {
    if (
      controller.disposed ||
      controller.cancelled() ||
      controller.appliedFullscreen ||
      controller.transition
    )
      return;
    void serialize(controller, async () => {
      if (
        controller.disposed ||
        controller.cancelled() ||
        controller.appliedFullscreen ||
        controller.transition
      )
        return;
      const bounds = await readCurrentBounds(controller);
      if (
        controller.disposed ||
        controller.cancelled() ||
        controller.appliedFullscreen ||
        controller.transition
      )
        return;
      await persistNormal(controller, bounds);
      controller.normal = bounds;
      const { screens, current } = await connectedMonitors();
      controller.normalMonitor =
        monitorWithLargestIntersection(bounds, screens)?.name ?? current?.name ?? null;
    }).catch((error) => console.warn('window state', error));
  }, 300);
}

function queueFullscreenReconcile(controller: Controller) {
  if (
    controller.disposed ||
    controller.cancelled() ||
    !controller.appliedFullscreen ||
    controller.transition ||
    controller.reconcileQueued
  )
    return;
  controller.reconcileQueued = true;
  queueMicrotask(() => {
    controller.reconcileQueued = false;
    void serialize(controller, () => reconcileFullscreen(controller)).catch((error) =>
      console.warn('display reconcile', error),
    );
  });
}

async function centerNormalOn(controller: Controller, monitor: MonitorGeometry, base: Geometry) {
  return clampGeometryToWorkArea(base, monitor, true) ?? base;
}

async function reconcileFullscreen(controller: Controller) {
  if (!controller.appliedFullscreen || controller.transition) return;
  const { screens, current, primary, target } = await resolveTarget(controller.lastRequest);
  if (!target) return;
  const desired = monitorRect(target);
  if (!validGeometry(desired)) return;
  const actual = await readCurrentBounds(controller);
  if (sameGeometry(actual, desired)) {
    controller.appliedMonitor = target.name;
    controller.fullBounds = desired;
    return;
  }

  controller.transition = true;
  try {
    ensureActive(controller);
    if (controller.normal && target.name !== controller.normalMonitor) {
      controller.normal = await centerNormalOn(controller, target, controller.normal);
      controller.normalMonitor = target.name;
      await persistNormal(controller, controller.normal);
    }
    ensureActive(controller);
    const placed = await placeBounds(desired);
    ensureActive(controller);
    controller.fullBounds = placed;
    controller.appliedMonitor = target.name;
  } finally {
    controller.transition = false;
  }
}

async function enterFullscreen(
  controller: Controller,
  request: DisplayRequest,
  target: MonitorGeometry,
  screens: MonitorGeometry[],
  current: MonitorGeometry | null,
) {
  controller.transition = true;
  clearTimeout(controller.timer);
  const previousTopmost = controller.appliedTopmost;
  let modeChanged = false;
  try {
    ensureActive(controller);
    const normal = await readCurrentBounds(controller);
    ensureActive(controller);
    controller.normal = normal;
    controller.normalMonitor =
      monitorWithLargestIntersection(normal, screens)?.name ?? current?.name ?? target.name;
    await persistNormal(controller, normal);
    ensureActive(controller);

    await setInteractionMode(true);
    modeChanged = true;
    ensureActive(controller);
    await setEffectiveTopmost(controller, true);
    const placed = await placeIfDifferent(controller, monitorRect(target));
    ensureActive(controller);
    controller.fullBounds = placed;
    controller.appliedFullscreen = true;
    controller.appliedMonitor = target.name;
    controller.lastRequest = request;
  } catch (error) {
    if (modeChanged && !controller.disposed && !controller.cancelled()) {
      try {
        await setInteractionMode(controller.appliedFullscreen);
      } catch (rollbackError) {
        console.warn('could not restore dashboard interaction mode', rollbackError);
      }
    }
    if (
      !controller.disposed &&
      !controller.cancelled() &&
      controller.appliedTopmost !== previousTopmost
    ) {
      try {
        await setEffectiveTopmost(controller, previousTopmost);
      } catch (rollbackError) {
        console.warn('could not restore dashboard topmost state', rollbackError);
      }
    }
    throw error;
  } finally {
    controller.transition = false;
  }
}

async function switchFullscreenMonitor(
  controller: Controller,
  request: DisplayRequest,
  target: MonitorGeometry,
) {
  const desired = monitorRect(target);
  if (!validGeometry(desired)) return;
  controller.transition = true;
  try {
    ensureActive(controller);
    if (controller.normal && target.name !== controller.normalMonitor) {
      controller.normal = await centerNormalOn(controller, target, controller.normal);
      controller.normalMonitor = target.name;
      await persistNormal(controller, controller.normal);
    }
    ensureActive(controller);
    const placed = await placeIfDifferent(controller, desired);
    ensureActive(controller);
    controller.fullBounds = placed;
    controller.appliedMonitor = target.name;
    controller.lastRequest = request;
  } finally {
    controller.transition = false;
  }
}

async function exitFullscreen(
  controller: Controller,
  request: DisplayRequest,
  target: MonitorGeometry,
) {
  const retained = controller.normal;
  if (!retained) throw new Error('No normal dashboard rectangle was retained');
  const targetChanged = target.name !== controller.normalMonitor;
  const desired = clampGeometryToWorkArea(retained, target, targetChanged) ?? retained;
  controller.transition = true;
  try {
    ensureActive(controller);
    const placed = await placeIfDifferent(controller, desired);
    ensureActive(controller);
    await setEffectiveTopmost(controller, request.alwaysOnTop);
    await setInteractionMode(false);
    ensureActive(controller);
    controller.appliedFullscreen = false;
    controller.appliedMonitor = target.name;
    controller.fullBounds = null;
    controller.normal = placed;
    controller.normalMonitor = target.name;
    controller.lastRequest = request;
    try {
      await persistNormal(controller, placed);
    } catch (error) {
      console.warn('window state', error);
    }
  } catch (error) {
    if (!controller.disposed && !controller.cancelled()) {
      try {
        await setInteractionMode(true);
      } catch (rollbackError) {
        console.warn('could not restore dashboard fullscreen mode', rollbackError);
      }
      try {
        await setEffectiveTopmost(controller, true);
      } catch (rollbackError) {
        console.warn('could not restore dashboard topmost state', rollbackError);
      }
      try {
        if (controller.fullBounds) await placeIfDifferent(controller, controller.fullBounds);
      } catch (rollbackError) {
        console.warn('could not restore dashboard fullscreen bounds', rollbackError);
      }
    }
    throw error;
  } finally {
    controller.transition = false;
  }
}

async function moveNormalToMonitor(
  controller: Controller,
  request: DisplayRequest,
  target: MonitorGeometry,
) {
  controller.transition = true;
  const previousTopmost = controller.appliedTopmost;
  try {
    ensureActive(controller);
    await setEffectiveTopmost(controller, request.alwaysOnTop);
    const current = await readCurrentBounds(controller);
    ensureActive(controller);
    const changed =
      request.monitor !== controller.lastRequest.monitor &&
      !!request.monitor &&
      target.name === request.monitor;
    const desired = clampGeometryToWorkArea(current, target, changed) ?? current;
    const placed = await placeIfDifferent(controller, desired);
    ensureActive(controller);
    controller.normal = placed;
    controller.normalMonitor = target.name;
    controller.appliedMonitor = target.name;
    controller.lastRequest = request;
    try {
      await persistNormal(controller, placed);
    } catch (error) {
      console.warn('window state', error);
    }
  } catch (error) {
    if (
      !controller.disposed &&
      !controller.cancelled() &&
      controller.appliedTopmost !== previousTopmost
    ) {
      try {
        await setEffectiveTopmost(controller, previousTopmost);
      } catch (rollbackError) {
        console.warn('could not restore dashboard topmost state', rollbackError);
      }
    }
    throw error;
  } finally {
    controller.transition = false;
  }
}

async function applyRequest(controller: Controller, request: DisplayRequest) {
  if (
    request.monitor === controller.lastRequest.monitor &&
    request.fullscreen === controller.lastRequest.fullscreen
  ) {
    await setEffectiveTopmost(controller, controller.appliedFullscreen || request.alwaysOnTop);
    controller.lastRequest = request;
    return controller.appliedFullscreen;
  }
  const { screens, current, primary, target } = await resolveTarget(request);
  ensureActive(controller);
  if (!target) {
    await setEffectiveTopmost(controller, controller.appliedFullscreen || request.alwaysOnTop);
    controller.lastRequest = { ...controller.lastRequest, alwaysOnTop: request.alwaysOnTop };
    return controller.appliedFullscreen;
  }

  if (request.fullscreen) {
    if (!controller.appliedFullscreen) {
      await enterFullscreen(controller, request, target, screens, current);
    } else if (
      controller.appliedMonitor !== target.name ||
      request.monitor !== controller.lastRequest.monitor
    ) {
      await switchFullscreenMonitor(controller, request, target);
    } else {
      const desired = monitorRect(target);
      const placed = await placeIfDifferent(controller, desired);
      controller.fullBounds = placed;
      controller.appliedMonitor = target.name;
      controller.lastRequest = request;
    }
    return controller.appliedFullscreen;
  }

  if (controller.appliedFullscreen) {
    await exitFullscreen(controller, request, target);
  } else if (request.monitor !== controller.lastRequest.monitor) {
    await moveNormalToMonitor(controller, request, target);
  } else {
    controller.lastRequest = request;
  }
  return controller.appliedFullscreen;
}

async function attachListeners(controller: Controller) {
  const onResize = () => {
    saveNormalLater(controller);
    queueFullscreenReconcile(controller);
  };
  controller.listeners.push(await controller.win.onMoved(() => saveNormalLater(controller)));
  controller.listeners.push(await controller.win.onResized(onResize));
  controller.listeners.push(await controller.win.onScaleChanged(onResize));
}

function disposeController(controller: Controller) {
  if (controller.disposed) return;
  controller.disposed = true;
  clearTimeout(controller.timer);
  for (const unlisten of controller.listeners.splice(0)) unlisten();
  if (activeController === controller) activeController = undefined;
}

export function getAppliedFullscreen() {
  return activeController?.appliedFullscreen ?? false;
}

export async function initDisplay(
  display: Settings['display'],
  deck: Page,
  cancelled: () => boolean = () => false,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  if (activeController) disposeController(activeController);

  const request = snapshotRequest(display);
  const controller: Controller = {
    win: getCurrentWindow(),
    store: await load('window-state.json', { defaults: {}, autoSave: 200 }),
    cancelled,
    chain: Promise.resolve(),
    disposed: false,
    transition: false,
    appliedFullscreen: false,
    appliedTopmost: false,
    appliedMonitor: null,
    lastRequest: { monitor: null, fullscreen: false, alwaysOnTop: false },
    normal: null,
    normalMonitor: null,
    fullBounds: null,
    listeners: [],
    reconcileQueued: false,
  };
  activeController = controller;

  try {
    controller.appliedTopmost = await controller.win.isAlwaysOnTop();
    ensureActive(controller);
    const saved = await controller.store.get<Geometry>('dashboard');
    if (cancelled()) {
      disposeController(controller);
      return () => {};
    }
    const [screens, current, primary, actual] = await Promise.all([
      monitorList(),
      currentMonitor() as Promise<MonitorGeometry | null>,
      primaryMonitor() as Promise<MonitorGeometry | null>,
      readCurrentBounds(controller),
    ]);
    if (cancelled()) {
      disposeController(controller);
      return () => {};
    }
    const selected = resolveStartupMonitor(
      screens,
      request.monitor,
      validGeometry(saved) ? saved : null,
      primary,
    );
    let normal: Geometry;
    if (!selected) {
      normal = validGeometry(actual) ? actual : { x: 0, y: 0, width: 770, height: 392 };
    } else if (validGeometry(saved)) {
      const savedMonitor = monitorWithLargestIntersection(saved, screens);
      const explicitChanged =
        !!request.monitor &&
        selected.name === request.monitor &&
        savedMonitor?.name !== selected.name;
      normal = clampGeometryToWorkArea(saved, selected, explicitChanged) ?? actual;
    } else {
      normal = firstLaunchGeometry(deck, selected) ?? actual;
    }
    if (!validGeometry(normal)) normal = { x: 0, y: 0, width: 770, height: 392 };

    await attachListeners(controller);
    if (cancelled()) {
      disposeController(controller);
      return () => {};
    }
    controller.transition = true;
    try {
      await setInteractionMode(false);
      if (cancelled()) {
        disposeController(controller);
        return () => {};
      }
      // Persist only the OS-adjusted rectangle returned by the native placement command.
      const placed = await placeBounds(normal);
      if (cancelled()) {
        disposeController(controller);
        return () => {};
      }
      controller.normal = placed;
      controller.normalMonitor =
        monitorWithLargestIntersection(placed, screens)?.name ??
        current?.name ??
        selected?.name ??
        null;
      await persistNormal(controller, placed);
    } finally {
      controller.transition = false;
    }

    if (request.fullscreen && selected) {
      await enterFullscreen(controller, request, selected, screens, current);
    } else {
      await setEffectiveTopmost(controller, request.alwaysOnTop);
      controller.appliedMonitor = selected?.name ?? current?.name ?? null;
      controller.lastRequest = request;
    }
    if (cancelled()) {
      disposeController(controller);
      return () => {};
    }
    return () => disposeController(controller);
  } catch (error) {
    disposeController(controller);
    if (cancelled()) return () => {};
    throw error;
  }
}

export async function applyDisplay(
  display: Settings['display'],
  _monitorChanged: boolean,
): Promise<boolean> {
  if (!isTauri()) return false;
  const controller = activeController;
  if (!controller || controller.disposed)
    throw new Error('Dashboard display controller is unavailable; reload the app');
  const request = snapshotRequest(display);
  return (
    (await serialize(controller, () => applyRequest(controller, request))) ??
    controller.appliedFullscreen
  );
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    if (activeController) disposeController(activeController);
  });

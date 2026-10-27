import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Page, Settings } from '../settings/schema';
import {
  connectedMonitors,
  openWindowStateStore,
  readWindowBounds,
  setDashboardBounds,
  setDashboardInteractionMode,
  type Geometry,
  type MonitorGeometry,
  type WindowStateStore,
} from '../../platform/window';
import {
  clampGeometryToWorkArea,
  firstLaunchGeometry,
  monitorRect,
  monitorWithLargestIntersection,
  resolveLiveMonitor,
  resolveStartupMonitor,
  sameGeometry,
  validGeometry,
} from './geometry';

type DisplayRequest = Pick<Settings['display'], 'monitor' | 'fullscreen' | 'alwaysOnTop'>;
type Controller = {
  win: ReturnType<typeof getCurrentWindow>;
  store: WindowStateStore;
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

let activeController: Controller | undefined;

const snapshotRequest = (display: DisplayRequest): DisplayRequest => ({
  monitor: display.monitor,
  fullscreen: display.fullscreen,
  alwaysOnTop: display.alwaysOnTop,
});

const readCurrentBounds = (controller: Controller) => readWindowBounds(controller.win);

async function placeBounds(bounds: Geometry): Promise<Geometry> {
  if (!validGeometry(bounds)) throw new Error('Refusing invalid dashboard bounds');
  return setDashboardBounds(bounds);
}

const setInteractionMode = setDashboardInteractionMode;

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
  const { target } = await resolveTarget(controller.lastRequest);
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
  const { screens, current, target } = await resolveTarget(request);
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
    store: await openWindowStateStore(),
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
    const [{ screens, current, primary }, actual] = await Promise.all([
      connectedMonitors(),
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

import { get, writable, type Readable } from 'svelte/store';
import type { EventAncestry } from '../../../features/plugins/contracts';
import type { AppletRuntimeContext } from '../../../features/applets/contracts';
import { normalizeSubwayLines, stepStation, type LineDefinition } from './lines';
import { announcementLanguages, firstStationForDirection, normalizeSubwayConfig } from './config';
import { createSubwayAudio, type SubwayAudioController } from '../audio/audio';
import {
  buildSegmentCuePlan,
  loadSubwayAssets,
  loadSubwayMotionEngine,
  type LoadedSubwayAssets,
  type SegmentCuePlan,
} from '../audio/sound-pack';
import {
  createRunState,
  nextRunWake,
  reduceRun,
  segmentPlanKey,
  snapshotRun,
  type RunCommand,
  type RunEffect,
  type RunSnapshot,
  type SubwayCuePlans,
  type SubwayRunState,
} from './run';

export interface SubwayRuntimeClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SubwayRuntimeOptions {
  clock?: SubwayRuntimeClock;
  loadAssets?: () => Promise<LoadedSubwayAssets>;
  assetBase?: string;
  onCue?: (effect: Extract<RunEffect, { type: 'play-cue' }>) => void | Promise<void>;
  audio?: SubwayAudioController;
}

export interface SubwaySurfaceRegistration {
  setEligible(eligible: boolean): void;
  dispose(): void;
}

export interface SubwayRuntimeHandle {
  dispatch(command: RunCommand, ancestry?: EventAncestry, audioGesture?: boolean): boolean;
  requestLine(
    args: { line?: unknown; direction?: unknown; startStation?: unknown },
    ancestry?: EventAncestry,
  ): boolean;
  setImmersion(enabled?: boolean, ancestry?: EventAncestry): boolean;
  getSnapshot(): RunSnapshot | undefined;
  isReady(): boolean;
  dispose(): void;
}

export interface SubwaySceneState {
  line: LineDefinition;
  snapshot: RunSnapshot;
  config: Readonly<Record<string, unknown>>;
}

const browserClock: SubwayRuntimeClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
};

const surfaces = new Set<{ eligible: boolean }>();
const surfaceListeners = new Set<(eligible: boolean) => void>();
const sceneState = writable<SubwaySceneState | undefined>(undefined);
export const subwaySceneState: Readable<SubwaySceneState | undefined> = {
  subscribe: (run, invalidate) => sceneState.subscribe(run, invalidate),
};
let activeRuntime: SubwayRuntimeHandle | undefined;
let activeRuntimeContext: AppletRuntimeContext | undefined;

function anyEligibleSurface(): boolean {
  return [...surfaces].some((surface) => surface.eligible);
}

function notifySurfaceChange(): void {
  const eligible = anyEligibleSurface();
  for (const listener of surfaceListeners) listener(eligible);
}

export function registerSubwaySurface(eligible = false): SubwaySurfaceRegistration {
  const surface = { eligible };
  surfaces.add(surface);
  notifySurfaceChange();
  let disposed = false;
  return {
    setEligible(value) {
      if (disposed || surface.eligible === value) return;
      surface.eligible = value;
      notifySurfaceChange();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      surfaces.delete(surface);
      notifySurfaceChange();
    },
  };
}

function subscribeSurfaceEligibility(listener: (eligible: boolean) => void): () => void {
  surfaceListeners.add(listener);
  listener(anyEligibleSurface());
  return () => surfaceListeners.delete(listener);
}

function buildCuePlans(
  lines: readonly LineDefinition[],
  assets: LoadedSubwayAssets,
  base: string,
  languages: readonly string[],
): SubwayCuePlans {
  const plans: Record<string, SegmentCuePlan> = {};
  for (const line of lines) {
    const bundle = assets.lines[line.id];
    if (!bundle) throw new Error(`Missing Subway asset bundle: ${line.id}`);
    for (const station of line.stations)
      for (const direction of line.directions) {
        const next = stepStation(line, station.code, direction.id);
        if (next) {
          plans[segmentPlanKey(line.id, station.code, next.code, direction.id)] =
            buildSegmentCuePlan(
              bundle,
              station.code,
              next.code,
              direction.id,
              languages,
              next.transfers.length > 0,
              assets.catalogue,
              base,
              assets.doorSequence,
            );
        }
        plans[segmentPlanKey(line.id, station.code, station.code, direction.id)] =
          buildSegmentCuePlan(
            bundle,
            station.code,
            station.code,
            direction.id,
            languages,
            station.transfers.length > 0,
            assets.catalogue,
            base,
            assets.doorSequence,
          );
      }
  }
  return Object.freeze(plans);
}

const projectionKeys = [
  'station',
  'next',
  'state',
  'line',
  'direction',
  'doorSide',
  'speed',
  'progress',
  'paused',
  'immersion',
] as const;
type ProjectionKey = (typeof projectionKeys)[number];

function project(snapshot: RunSnapshot): Record<ProjectionKey, string | number | boolean> {
  return {
    station: snapshot.station,
    next: snapshot.next,
    state: snapshot.state,
    line: snapshot.line,
    direction: snapshot.direction,
    doorSide: snapshot.doorSide,
    speed: snapshot.speed,
    progress: snapshot.progress,
    paused: snapshot.paused,
    immersion: snapshot.immersion,
  };
}

function eventFor(effect: Exclude<RunEffect, { type: 'play-cue' }>): {
  id: string;
  parameter?: string;
  payload: unknown;
} {
  if (effect.type === 'departed')
    return {
      id: 'subway.departed',
      parameter: effect.from,
      payload: {
        line: effect.line,
        direction: effect.direction,
        from: effect.from,
        to: effect.to,
        generation: effect.generation,
      },
    };
  if (effect.type === 'arrived')
    return {
      id: 'subway.arrived',
      parameter: effect.to,
      payload: {
        line: effect.line,
        direction: effect.direction,
        from: effect.from,
        to: effect.to,
        generation: effect.generation,
      },
    };
  if (effect.type === 'state-changed')
    return {
      id: 'subway.stateChanged',
      parameter: effect.state,
      payload: { generation: effect.generation },
    };
  return {
    id: effect.type === 'emergency' ? 'subway.emergency' : 'subway.suspended',
    payload: { generation: effect.generation },
  };
}

export function createSubwayRuntime(
  context: AppletRuntimeContext,
  options: SubwayRuntimeOptions = {},
): SubwayRuntimeHandle {
  const clock = options.clock ?? browserClock;
  const loadAssets = options.loadAssets ?? (() => loadSubwayAssets(options.assetBase));
  const assetBase = options.assetBase ?? '/subway/';
  let alive = true;
  let ready = false;
  let eligible = false;
  const audio =
    options.audio ??
    createSubwayAudio({
      loadEngine: () => loadSubwayMotionEngine(assetBase),
      onAvailability: (available) => {
        if (alive && eligible) void context.setState('audioReady', available).catch(() => {});
      },
    });
  let unavailable = false;
  let epoch = 0;
  let timer: unknown;
  let lines: readonly LineDefinition[] = [];
  let assets: LoadedSubwayAssets | undefined;
  let plans: SubwayCuePlans = {};
  let state: SubwayRunState | undefined;
  let autoStarted = false;
  let lastDiscreteProjection = '';
  let lastNumericProjectionAt = Number.NEGATIVE_INFINITY;
  let lastSceneProjection = '';
  let lastSceneProjectionAt = Number.NEGATIVE_INFINITY;
  let projectionChain = Promise.resolve();
  let currentConfig = get(context.config);
  let appliedConfig: ReturnType<typeof normalizeSubwayConfig> | undefined;
  const overrides = { line: false, direction: false, startStation: false, immersion: false };
  const unsubscribeSurface = subscribeSurfaceEligibility((value) => {
    if (eligible === value) return;
    eligible = value;
    audio.setVisible(value);
    if (!alive || !ready) return;
    if (!state) {
      if (eligible && unavailable) publishUnavailable();
      return;
    }
    if (eligible) {
      dispatch({ type: 'resume' });
      syncConfig();
      autoStartIfNeeded();
    } else dispatch({ type: 'pause' });
  });

  function publishUnavailable(): void {
    const runtimeEpoch = epoch;
    projectionChain = projectionChain
      .then(async () => {
        if (!alive || runtimeEpoch !== epoch || !eligible || !unavailable) return;
        if (!Object.is(context.getState('state'), 'unavailable'))
          await context.setState('state', 'unavailable');
        if (!alive || runtimeEpoch !== epoch || !eligible || !unavailable) return;
        if (!Object.is(context.getState('paused'), true)) await context.setState('paused', true);
      })
      .catch(() => undefined);
  }

  function clearWake(): void {
    if (timer === undefined) return;
    clock.clearTimeout(timer);
    timer = undefined;
  }

  function scheduleWake(): void {
    clearWake();
    if (!alive || !ready || !eligible || !state) return;
    const now = clock.now();
    const wakeAt = nextRunWake(state, now);
    if (wakeAt === null) return;
    timer = clock.setTimeout(
      () => {
        timer = undefined;
        dispatch({ type: 'tick' });
      },
      Math.max(0, wakeAt - now),
    );
  }

  function publishScene(force = false): void {
    if (!alive || !eligible || !state || !lines.length) return;
    const now = clock.now();
    const line = lines.find((item) => item.id === state!.lineId);
    if (!line) return;
    const snapshot = snapshotRun(state, now, lines, plans);
    const discrete = [
      snapshot.station,
      snapshot.next,
      snapshot.state,
      snapshot.line,
      snapshot.direction,
      snapshot.doorSide,
      snapshot.doors,
      snapshot.paused,
      snapshot.immersion,
      snapshot.multiplier,
      snapshot.generation,
      currentConfig.displayLanguages,
      currentConfig.announcementLanguages,
      currentConfig.manualView,
    ].join('|');
    if (!force && discrete === lastSceneProjection && now - lastSceneProjectionAt < 250) return;
    lastSceneProjection = discrete;
    lastSceneProjectionAt = now;
    sceneState.set(
      Object.freeze({
        line,
        snapshot: Object.freeze(snapshot),
        config: Object.freeze({ ...currentConfig }),
      }),
    );
  }

  function queueEffects(
    effects: readonly RunEffect[],
    nextState: SubwayRunState,
    runtimeEpoch: number,
    allowHidden = false,
    ancestry?: EventAncestry,
  ): void {
    const settled = nextRunWake(nextState, clock.now()) === null;
    publishScene(settled);
    const capturedGeneration = nextState.generation;
    projectionChain = projectionChain
      .then(async () => {
        if (
          !alive ||
          runtimeEpoch !== epoch ||
          (!eligible && !allowHidden) ||
          !state ||
          state.generation !== capturedGeneration
        )
          return;
        const now = clock.now();
        const snapshot = snapshotRun(nextState, now, lines, plans);
        const values = project(snapshot);
        const discrete = [
          snapshot.station,
          snapshot.next,
          snapshot.state,
          snapshot.line,
          snapshot.direction,
          snapshot.doorSide,
          snapshot.doors,
          snapshot.paused,
          snapshot.immersion,
          snapshot.multiplier,
          snapshot.generation,
        ].join('|');
        const discreteChanged = discrete !== lastDiscreteProjection;
        if (settled || discreteChanged || now - lastNumericProjectionAt >= 250) {
          lastDiscreteProjection = discrete;
          lastNumericProjectionAt = now;
          for (const key of projectionKeys) {
            if (
              !alive ||
              runtimeEpoch !== epoch ||
              (!eligible && !allowHidden) ||
              !state ||
              state.generation !== capturedGeneration
            )
              return;
            const value = values[key];
            if (Object.is(context.getState(key), value)) continue;
            await context.setState(key, value);
          }
        }
        for (const effect of effects) {
          if (
            !alive ||
            runtimeEpoch !== epoch ||
            (!eligible && !allowHidden) ||
            !state ||
            state.generation !== effect.generation
          )
            return;
          if (effect.type === 'play-cue') {
            if (eligible && nextState.immersion) {
              void audio.playCue(effect);
              await options.onCue?.(effect);
            }
            continue;
          }
          const event = eventFor(effect);
          await context.emitEvent(event.id, event.parameter, event.payload, ancestry);
        }
      })
      .catch(() => undefined);
  }

  function dispatch(command: RunCommand, ancestry?: EventAncestry, audioGesture = false): boolean {
    if (!alive || !ready || (!eligible && command.type !== 'pause') || !state || !lines.length)
      return false;
    const runtimeEpoch = epoch;
    const previousLine = state.lineId;
    const transition = reduceRun(state, command, clock.now(), lines, plans);
    state = transition.state;
    if (state.lineId !== previousLine) audio.resetLine(audioGesture);
    audio.transition(snapshotRun(state, clock.now(), lines, plans), transition.effects);
    if (state.pendingCues.length) {
      const group = state.pendingCues[0].id.split(':').slice(0, -1).join(':');
      audio.preload(
        state.pendingCues.filter((cue) => cue.id.startsWith(`${group}:`)).map((cue) => cue.cue),
      );
    }
    scheduleWake();
    queueEffects(transition.effects, state, runtimeEpoch, command.type === 'pause', ancestry);
    return true;
  }

  function autoStartIfNeeded(): boolean {
    if (!alive || !ready || !eligible || !state || !lines.length) return false;
    if (state.active) {
      autoStarted = true;
      return true;
    }
    if (autoStarted) return false;
    const line = lines.find((item) => item.id === state!.lineId);
    if (!line || !stepStation(line, state.stationCode, state.direction)) return false;
    dispatch({ type: 'start' });
    autoStarted = state.active;
    return autoStarted;
  }

  function requestLine(
    args: { line?: unknown; direction?: unknown; startStation?: unknown },
    ancestry?: EventAncestry,
  ): boolean {
    if (!alive || !ready || !eligible || !state || !lines.length) return false;
    const currentLine = lines.find((item) => item.id === state!.lineId)!;
    const requestedLine = typeof args.line === 'string' && args.line.trim() ? args.line : undefined;
    const nextLine =
      requestedLine === undefined
        ? lines[(lines.findIndex((item) => item.id === currentLine.id) + 1) % lines.length]
        : lines.find((item) => item.id === requestedLine);
    if (!nextLine) return false;
    const requestedDirection =
      typeof args.direction === 'string' && args.direction.trim() ? args.direction : undefined;
    const direction =
      requestedDirection ??
      (nextLine.id === currentLine.id &&
      nextLine.directions.some((item) => item.id === state!.direction)
        ? state.direction
        : nextLine.directions[0].id);
    if (!nextLine.directions.some((item) => item.id === direction)) return false;
    const requestedStation =
      typeof args.startStation === 'string' && args.startStation.trim()
        ? args.startStation
        : undefined;
    const stationCode =
      requestedStation ??
      (nextLine.id === currentLine.id &&
      nextLine.stations.some((item) => item.code === state!.stationCode)
        ? state.stationCode
        : firstStationForDirection(nextLine, direction));
    if (!nextLine.stations.some((item) => item.code === stationCode)) return false;
    overrides.line = true;
    if (requestedDirection !== undefined) overrides.direction = true;
    if (requestedStation !== undefined || nextLine.id !== currentLine.id)
      overrides.startStation = true;
    if (
      !dispatch({ type: 'configure', lineId: nextLine.id, direction, stationCode }, ancestry, true)
    )
      return false;
    autoStarted = false;
    autoStartIfNeeded();
    return true;
  }

  function setImmersion(enabled?: boolean, ancestry?: EventAncestry): boolean {
    if (!alive || !ready || !eligible || !state) return false;
    const requested = enabled ?? !state.immersion;
    if (requested) audio.setEnabled(true, true);
    else audio.setEnabled(false);
    overrides.immersion = true;
    return dispatch({ type: 'set-immersion', enabled: requested }, ancestry);
  }

  function getSnapshot(): RunSnapshot | undefined {
    return state && lines.length ? snapshotRun(state, clock.now(), lines, plans) : undefined;
  }

  function dispose(): void {
    if (!alive) return;
    alive = false;
    epoch++;
    clearWake();
    unsubscribeSurface();
    unsubscribeConfig();
    audio.dispose();
    if (activeRuntime === handle) {
      activeRuntime = undefined;
      sceneState.set(undefined);
    }
  }

  const handle: SubwayRuntimeHandle = {
    dispatch,
    requestLine,
    setImmersion,
    getSnapshot,
    isReady: () => ready,
    dispose,
  };
  activeRuntime = handle;

  function syncConfig(): void {
    if (!alive || !ready || !eligible || !state || !lines.length) return;
    const config = normalizeSubwayConfig(currentConfig, lines);
    const previous = appliedConfig;
    const routeChanged =
      !previous ||
      config.line !== previous.line ||
      config.direction !== previous.direction ||
      config.startStation !== previous.startStation;
    if (previous) {
      if (config.line !== previous.line) overrides.line = false;
      if (config.direction !== previous.direction) overrides.direction = false;
      if (config.startStation !== previous.startStation) overrides.startStation = false;
      if (config.immersion !== previous.immersion) overrides.immersion = false;
    }
    appliedConfig = config;
    currentConfig = config;
    audio.setAnnouncementVolume(config.announcementVolume);
    const targetLine = overrides.line
      ? lines.find((item) => item.id === state!.lineId)!
      : lines.find((item) => item.id === config.line)!;
    const requestedDirection = overrides.direction ? state.direction : config.direction;
    const direction = targetLine.directions.some((item) => item.id === requestedDirection)
      ? requestedDirection
      : targetLine.directions[0].id;
    const requestedStation = overrides.startStation ? state.stationCode : config.startStation;
    const stationCode = targetLine.stations.some((item) => item.code === requestedStation)
      ? requestedStation
      : firstStationForDirection(targetLine, direction);
    if (
      routeChanged &&
      (state.lineId !== targetLine.id ||
        state.direction !== direction ||
        state.stationCode !== stationCode)
    ) {
      dispatch({ type: 'configure', lineId: targetLine.id, direction, stationCode });
      autoStarted = false;
      autoStartIfNeeded();
    }
    if (config.speed !== state.nextMultiplier)
      dispatch({ type: 'set-speed', multiplier: config.speed });
    if (!overrides.immersion && config.immersion !== state.immersion)
      dispatch({ type: 'set-immersion', enabled: config.immersion });
    if (assets && previous?.announcementLanguages !== config.announcementLanguages)
      plans = buildCuePlans(
        lines,
        assets,
        assetBase,
        announcementLanguages(config.announcementLanguages),
      );
    publishScene(true);
  }

  const unsubscribeConfig = context.config.subscribe((config) => {
    currentConfig = config;
    syncConfig();
    autoStartIfNeeded();
  });

  const requestEpoch = epoch;
  void loadAssets()
    .then((loadedAssets) => {
      if (!alive || requestEpoch !== epoch) return;
      assets = loadedAssets;
      lines = normalizeSubwayLines(loadedAssets.lines);
      const config = normalizeSubwayConfig(currentConfig, lines);
      currentConfig = config;
      appliedConfig = config;
      const line = lines.find((item) => item.id === config.line)!;
      const stationCode = config.startStation;
      const direction = config.direction;
      plans = buildCuePlans(
        lines,
        loadedAssets,
        assetBase,
        announcementLanguages(config.announcementLanguages),
      );
      state = createRunState(lines, {
        lineId: line.id,
        stationCode,
        direction,
        multiplier: config.speed,
        dwellSeconds: Math.max(
          0,
          typeof config.dwellSeconds === 'number' && Number.isFinite(config.dwellSeconds)
            ? config.dwellSeconds
            : 15,
        ),
        immersion: config.immersion,
        now: clock.now(),
      });
      ready = true;
      audio.setAnnouncementVolume(config.announcementVolume);
      audio.setEnabled(state.immersion);
      audio.transition(snapshotRun(state, clock.now(), lines, plans), []);
      if (eligible) {
        syncConfig();
        if (!autoStartIfNeeded()) {
          queueEffects([], state, epoch);
          if (state.pendingCues.length) audio.preload(state.pendingCues.map((cue) => cue.cue));
          scheduleWake();
        }
      }
    })
    .catch(() => {
      if (!alive || requestEpoch !== epoch) return;
      ready = true;
      unavailable = true;
      if (eligible) publishUnavailable();
    });

  return handle;
}

export function runtime(context: AppletRuntimeContext): () => void {
  const handle = createSubwayRuntime(context);
  activeRuntimeContext = context;
  return () => {
    handle.dispose();
    if (activeRuntimeContext === context) activeRuntimeContext = undefined;
  };
}

export function dispatchSubwayCommand(command: RunCommand, ancestry?: EventAncestry): boolean {
  return activeRuntime?.dispatch(command, ancestry) ?? false;
}

export function requestSubwayLine(
  args: { line?: unknown; direction?: unknown; startStation?: unknown },
  ancestry?: EventAncestry,
): boolean {
  return activeRuntime?.requestLine(args, ancestry) ?? false;
}

export function setSubwayImmersion(enabled?: boolean, ancestry?: EventAncestry): boolean {
  return activeRuntime?.setImmersion(enabled, ancestry) ?? false;
}

export function requestSubwayView(viewId: string, ancestry?: EventAncestry): Promise<boolean> {
  if (!activeRuntimeContext || !['display', 'map', 'cab'].includes(viewId))
    return Promise.resolve(false);
  return activeRuntimeContext.setView(viewId, ancestry);
}

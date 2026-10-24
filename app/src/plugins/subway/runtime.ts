import { get } from 'svelte/store';
import type { SkinRuntimeContext } from '../../core/skins';
import { normalizeSubwayLines, stepStation, type LineDefinition } from './lines';
import {
  buildSegmentCuePlan, loadSubwayAssets, type LoadedSubwayAssets, type SegmentCuePlan,
} from './sound-pack';
import {
  createRunState, nextRunWake, reduceRun, segmentPlanKey, snapshotRun,
  type RunCommand, type RunEffect, type RunSnapshot, type SubwayCuePlans, type SubwayRunState,
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
}

export interface SubwaySurfaceRegistration {
  setEligible(eligible: boolean): void;
  dispose(): void;
}

export interface SubwayRuntimeHandle {
  dispatch(command: RunCommand): boolean;
  getSnapshot(): RunSnapshot | undefined;
  isReady(): boolean;
  dispose(): void;
}

const browserClock: SubwayRuntimeClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: handle => globalThis.clearTimeout(handle as number),
};

const surfaces = new Set<{ eligible: boolean }>();
const surfaceListeners = new Set<(eligible: boolean) => void>();
let activeRuntime: SubwayRuntimeHandle | undefined;

function anyEligibleSurface(): boolean { return [...surfaces].some(surface => surface.eligible); }

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

function configString(config: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const value = config[key];
  return typeof value === 'string' && value ? value : fallback;
}

function configNumber(config: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function configLanguages(config: Readonly<Record<string, unknown>>): string[] {
  const value = config.languages;
  const languages = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && ['ja', 'en', 'zh', 'ko'].includes(item)) : ['ja', 'en'];
  return [...new Set(languages.length ? languages : ['ja', 'en'])];
}

function buildCuePlans(lines: readonly LineDefinition[], assets: LoadedSubwayAssets, base: string, languages: readonly string[]): SubwayCuePlans {
  const plans: Record<string, SegmentCuePlan> = {};
  for (const line of lines) {
    const bundle = assets.lines[line.id];
    if (!bundle) throw new Error(`Missing Subway asset bundle: ${line.id}`);
    for (const station of line.stations) for (const direction of line.directions) {
      const next = stepStation(line, station.code, direction.id);
      if (next) {
        plans[segmentPlanKey(line.id, station.code, next.code, direction.id)] = buildSegmentCuePlan(
          bundle, station.code, next.code, direction.id, languages, next.transfers.length > 0,
          assets.catalogue, base, assets.doorSequence,
        );
      }
      plans[segmentPlanKey(line.id, station.code, station.code, direction.id)] = buildSegmentCuePlan(
        bundle, station.code, station.code, direction.id, languages, station.transfers.length > 0,
        assets.catalogue, base, assets.doorSequence,
      );
    }
  }
  return Object.freeze(plans);
}

const projectionKeys = ['station', 'next', 'state', 'line', 'direction', 'doorSide', 'speed', 'progress', 'paused', 'immersion'] as const;
type ProjectionKey = typeof projectionKeys[number];

function project(snapshot: RunSnapshot): Record<ProjectionKey, string | number | boolean> {
  return {
    station: snapshot.station, next: snapshot.next, state: snapshot.state, line: snapshot.line,
    direction: snapshot.direction, doorSide: snapshot.doorSide, speed: snapshot.speed,
    progress: snapshot.progress, paused: snapshot.paused, immersion: snapshot.immersion,
  };
}

function eventFor(effect: Exclude<RunEffect, { type: 'play-cue' }>): { id: string; parameter?: string; payload: unknown } {
  if (effect.type === 'departed') return {
    id: 'subway.departed', parameter: effect.from,
    payload: { line: effect.line, direction: effect.direction, from: effect.from, to: effect.to, generation: effect.generation },
  };
  if (effect.type === 'arrived') return {
    id: 'subway.arrived', parameter: effect.to,
    payload: { line: effect.line, direction: effect.direction, from: effect.from, to: effect.to, generation: effect.generation },
  };
  if (effect.type === 'state-changed') return { id: 'subway.stateChanged', parameter: effect.state, payload: { generation: effect.generation } };
  return { id: effect.type === 'emergency' ? 'subway.emergency' : 'subway.suspended', payload: { generation: effect.generation } };
}

export function createSubwayRuntime(context: SkinRuntimeContext, options: SubwayRuntimeOptions = {}): SubwayRuntimeHandle {
  const clock = options.clock ?? browserClock;
  const loadAssets = options.loadAssets ?? (() => loadSubwayAssets(options.assetBase));
  const assetBase = options.assetBase ?? '/subway/';
  let alive = true;
  let ready = false;
  let eligible = false;
  let unavailable = false;
  let epoch = 0;
  let timer: unknown;
  let lines: readonly LineDefinition[] = [];
  let plans: SubwayCuePlans = {};
  let state: SubwayRunState | undefined;
  let lastDiscreteProjection = '';
  let lastNumericProjectionAt = Number.NEGATIVE_INFINITY;
  let projectionChain = Promise.resolve();
  let currentConfig = get(context.config);
  const unsubscribeSurface = subscribeSurfaceEligibility(value => {
    if (eligible === value) return;
    eligible = value;
    if (!alive || !ready) return;
    if (!state) {
      if (eligible && unavailable) publishUnavailable();
      return;
    }
    dispatch({ type: eligible ? 'resume' : 'pause' });
  });

  function publishUnavailable(): void {
    const runtimeEpoch = epoch;
    projectionChain = projectionChain.then(async () => {
      if (!alive || runtimeEpoch !== epoch || !eligible || !unavailable) return;
      if (!Object.is(context.getState('state'), 'unavailable')) await context.setState('state', 'unavailable');
      if (!alive || runtimeEpoch !== epoch || !eligible || !unavailable) return;
      if (!Object.is(context.getState('paused'), true)) await context.setState('paused', true);
    }).catch(() => undefined);
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
    timer = clock.setTimeout(() => {
      timer = undefined;
      dispatch({ type: 'tick' });
    }, Math.max(0, wakeAt - now));
  }

  function queueEffects(effects: readonly RunEffect[], nextState: SubwayRunState, runtimeEpoch: number, allowHidden = false): void {
    const capturedGeneration = nextState.generation;
    projectionChain = projectionChain.then(async () => {
      if (!alive || runtimeEpoch !== epoch || (!eligible && !allowHidden) || !state || state.generation !== capturedGeneration) return;
      const now = clock.now();
      const snapshot = snapshotRun(nextState, now, lines, plans);
      const values = project(snapshot);
      const discrete = [snapshot.station, snapshot.next, snapshot.state, snapshot.line, snapshot.direction,
        snapshot.doorSide, snapshot.doors, snapshot.paused, snapshot.immersion, snapshot.multiplier, snapshot.generation].join('|');
      const discreteChanged = discrete !== lastDiscreteProjection;
      if (discreteChanged || now - lastNumericProjectionAt >= 250) {
        lastDiscreteProjection = discrete;
        lastNumericProjectionAt = now;
        for (const key of projectionKeys) {
          if (!alive || runtimeEpoch !== epoch || (!eligible && !allowHidden) || !state || state.generation !== capturedGeneration) return;
          const value = values[key];
          if (Object.is(context.getState(key), value)) continue;
          await context.setState(key, value);
        }
      }
      for (const effect of effects) {
        if (!alive || runtimeEpoch !== epoch || (!eligible && !allowHidden) || !state || state.generation !== effect.generation) return;
        if (effect.type === 'play-cue') {
          if (eligible && nextState.immersion) await options.onCue?.(effect);
          continue;
        }
        const event = eventFor(effect);
        await context.emitEvent(event.id, event.parameter, event.payload);
      }
    }).catch(() => undefined);
  }

  function dispatch(command: RunCommand): boolean {
    if (!alive || !ready || (!eligible && command.type !== 'pause') || !state || !lines.length) return false;
    const runtimeEpoch = epoch;
    const transition = reduceRun(state, command, clock.now(), lines, plans);
    state = transition.state;
    scheduleWake();
    queueEffects(transition.effects, state, runtimeEpoch, command.type === 'pause');
    return true;
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
    if (activeRuntime === handle) activeRuntime = undefined;
  }

  const handle: SubwayRuntimeHandle = { dispatch, getSnapshot, isReady: () => ready, dispose };
  activeRuntime = handle;

  const unsubscribeConfig = context.config.subscribe(config => {
    currentConfig = config;
    if (!ready || !state || !eligible) return;
    const currentState = state;
    const lineId = configString(config, 'line', currentState.lineId);
    if (lineId !== currentState.lineId && lines.some(line => line.id === lineId)) dispatch({ type: 'set-line', lineId: lineId as LineDefinition['id'] });
    const multiplier = configNumber(config, 'speed', currentState.nextMultiplier);
    if (multiplier !== currentState.nextMultiplier && [0.5, 1, 2].includes(multiplier)) dispatch({ type: 'set-speed', multiplier });
    const direction = configString(config, 'direction', currentState.direction);
    if (direction !== currentState.direction && lines.find(line => line.id === currentState.lineId)?.directions.some(item => item.id === direction))
      dispatch({ type: 'set-direction', direction });
    if (typeof config.immersion === 'boolean' && config.immersion !== currentState.immersion)
      dispatch({ type: 'set-immersion', enabled: config.immersion });
  });

  const requestEpoch = epoch;
  void loadAssets().then(assets => {
    if (!alive || requestEpoch !== epoch) return;
    lines = normalizeSubwayLines(assets.lines);
    const config = currentConfig;
    const lineId = configString(config, 'line', 'yamanote') as LineDefinition['id'];
    const line = lines.find(item => item.id === lineId) ?? lines[0];
    const stationCode = configString(config, 'station', line.stations[0].code);
    const direction = configString(config, 'direction', line.directions[0].id);
    const languages = configLanguages(config);
    plans = buildCuePlans(lines, assets, assetBase, languages);
    state = createRunState(lines, {
      lineId: line.id,
      stationCode: line.stations.some(item => item.code === stationCode) ? stationCode : line.stations[0].code,
      direction: line.directions.some(item => item.id === direction) ? direction : line.directions[0].id,
      multiplier: [0.5, 1, 2].includes(configNumber(config, 'speed', 1)) ? configNumber(config, 'speed', 1) : 1,
      dwellSeconds: Math.max(0, configNumber(config, 'dwellSeconds', 15)),
      immersion: typeof config.immersion === 'boolean' ? config.immersion : true,
      now: clock.now(),
    });
    ready = true;
    if (eligible) {
      queueEffects([], state, epoch);
      scheduleWake();
    }
  }).catch(() => {
    if (!alive || requestEpoch !== epoch) return;
    ready = true;
    unavailable = true;
    if (eligible) publishUnavailable();
  });

  return handle;
}

export function runtime(context: SkinRuntimeContext): () => void {
  const handle = createSubwayRuntime(context);
  return () => handle.dispose();
}

export function dispatchSubwayCommand(command: RunCommand): boolean {
  return activeRuntime?.dispatch(command) ?? false;
}

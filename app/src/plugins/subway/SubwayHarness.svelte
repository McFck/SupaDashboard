<script lang="ts">
  import { onMount } from 'svelte';
  import { SceneScheduler } from '../../core/skin-scene';
  import { normalizeSubwayLines, type LineDefinition, type RawLineBundle } from './lines';
  import { scheduleScreen, type ScreenConfig, type ScreenSchedule } from './screens';
  import { createYamanoteRenderer } from './lcd/yamanote';
  import { createRunState, reduceRun, snapshotRun, type RunPhase, type RunSnapshot, type SubwayRunState } from './run';
  import type { PlatformDirectionDetail } from './station-details';

  type Fixture = { id: string; line: LineDefinition; snapshot: RunSnapshot; elapsed: number; config: ScreenConfig };
  type FixtureReport = {
    id: string; state: RunPhase; page: string; language: string; direction: string; station: string;
    next: string; sideLabel: string | null; facilityCount: number;
  };
  type HarnessApi = {
    manifest: FixtureReport[];
    render(id: string): FixtureReport;
    startStaticProbe(): void;
    updateWidgetOnly(count: number): void;
    metrics(): Record<string, unknown>;
    stopStaticProbe(): void;
  };
  type HarnessWindow = Window & { __subwayHarness?: HarnessApi };

  const lineModules = import.meta.glob('../../../../assets/lines/*/{line,pack}.json',
    { eager: true, import: 'default' }) as Record<string, unknown>;
  const lineBundles: Record<string, RawLineBundle> = {};
  for (const [path, value] of Object.entries(lineModules)) {
    const id = path.includes('/yamanote/') ? 'yamanote' : path.includes('/hibiya/') ? 'hibiya'
      : path.includes('/sakaisuji/') ? 'sakaisuji' : undefined;
    if (!id) continue;
    lineBundles[id] ??= { line: undefined, pack: undefined };
    if (path.endsWith('/line.json')) lineBundles[id].line = value;
    else if (path.endsWith('/pack.json')) lineBundles[id].pack = value;
  }
  const lines = normalizeSubwayLines(lineBundles);
  const yamanote = lines.find(line => line.id === 'yamanote')!;
  const languages = ['ja', 'en'];
  let canvas: HTMLCanvasElement;
  let renderer = createYamanoteRenderer();
  let drawCount = 0;
  let renderDurations: number[] = [];
  let widgetOnlyUpdates = 0;
  let staticProbe: {
    scheduler: SceneScheduler;
    renderer: ReturnType<typeof createYamanoteRenderer>;
    requests: number; executed: number; cancelled: number; draws: number; pending: Set<number>;
  } | undefined;

  function stateFor(target: RunPhase, direction = 'inner'): SubwayRunState {
    let state = createRunState(lines, { lineId: 'yamanote', stationCode: 'JY01', direction, dwellSeconds: 0, immersion: false, now: 0 });
    if (target === 'stopped') return state;
    state = reduceRun(state, { type: 'start' }, 0, lines).state;
    const phaseTarget: RunPhase = target === 'emergency' || target === 'suspended' ? 'cruising' : target;
    let guard = 0;
    while (state.phase !== phaseTarget && guard++ < 120) {
      const deadline = state.phase === 'stopped' ? state.stopDeadline : state.phaseDeadline;
      if (deadline === null) throw new Error(`No deadline while building ${target} fixture (${state.phase})`);
      let at = state.lastTickAt;
      if (deadline <= at) state = reduceRun(state, { type: 'tick' }, deadline, lines).state;
      while (at < deadline) {
        at = Math.min(deadline, at + 1_000);
        state = reduceRun(state, { type: 'tick' }, at, lines).state;
      }
    }
    if (state.phase !== phaseTarget) throw new Error(`Could not build ${target} fixture`);
    if (target === 'emergency' || target === 'suspended') {
      state = reduceRun(state, { type: target === 'emergency' ? 'emergency' : 'suspend' }, state.lastTickAt + 1_000, lines).state;
    }
    return state;
  }

  function lineWithSide(side: 'left' | 'right' | 'unknown'): LineDefinition {
    const stations = yamanote.stations.map(station => {
      if (station.code !== 'JY01') return station;
      const current = station.doorByDirection.inner;
      return Object.freeze({ ...station, doorByDirection: Object.freeze({
        ...station.doorByDirection,
        inner: Object.freeze({ ...current, side, provenance: 'Browser fixture only', sources: Object.freeze([]), synthetic: true }),
      }) });
    });
    return Object.freeze({ ...yamanote, stations: Object.freeze(stations) });
  }

  function lineWithFacilities(): LineDefinition {
    const facilities = Object.freeze([
      Object.freeze({ kind: 'lift' as const, car: 3, relativePosition: 0.24, label: 'Lift', source: 'Browser fixture only', revision: 'fixture' }),
      Object.freeze({ kind: 'exit' as const, car: 8, relativePosition: 0.76, label: 'Exit', source: 'Browser fixture only', revision: 'fixture' }),
    ]);
    const stations = yamanote.stations.map(station => {
      if (station.code !== 'JY01') return station;
      const current = station.platformByDirection.inner;
      const detail: PlatformDirectionDetail = Object.freeze({ ...current, facilities, provenance: 'Browser fixture only', synthetic: true });
      return Object.freeze({ ...station, platformByDirection: Object.freeze({ ...station.platformByDirection, inner: detail }) });
    });
    return Object.freeze({ ...yamanote, stations: Object.freeze(stations) });
  }

  function fixture(id: string, state: RunPhase, elapsed = 0, options: {
    direction?: string; line?: LineDefinition; config?: Partial<ScreenConfig>;
  } = {}): Fixture {
    const line = options.line ?? yamanote;
    const run = stateFor(state, options.direction ?? 'inner');
    const snapshot = snapshotRun(run, run.lastTickAt, lines);
    return {
      id, line, snapshot, elapsed,
      config: { line, languages, ...options.config },
    };
  }

  const fixtures: Fixture[] = [
    fixture('stopped-platform', 'stopped'),
    fixture('stopped-nearby-en', 'stopped', 6_000),
    fixture('doors-closing', 'doorsClosing'),
    fixture('departing-nearby', 'departing'),
    fixture('cruising-broad-ja', 'cruising'),
    fixture('cruising-broad-en', 'cruising', 6_000),
    fixture('cruising-nearby-en', 'cruising', 10_000),
    fixture('cruising-transfers', 'cruising', 16_000),
    fixture('approaching-platform', 'approaching'),
    fixture('arriving-platform', 'arriving'),
    fixture('emergency-four-language', 'emergency'),
    fixture('suspension-four-language', 'suspended'),
    fixture('outer-loop-broad', 'cruising', 0, { direction: 'outer' }),
    fixture('side-this-fixture', 'stopped', 0, { line: lineWithSide('right'), config: { viewingSide: 'right' } }),
    fixture('side-opposite-fixture', 'stopped', 0, { line: lineWithSide('right'), config: { viewingSide: 'left' } }),
    fixture('side-unknown-default', 'stopped', 0, { line: lineWithSide('unknown') }),
    fixture('empty-facilities-default', 'stopped'),
    fixture('synthetic-facilities-fixture', 'stopped', 0, { line: lineWithFacilities() }),
    fixture('manual-map-cruising', 'cruising', 0, { config: { manualView: 'map' } }),
    fixture('manual-map-emergency-still-pinned', 'emergency', 0, { config: { manualView: 'map' } }),
    fixture('ja-only', 'cruising', 0, { config: { languages: ['ja'] } }),
    fixture('en-only', 'cruising', 0, { config: { languages: ['en'] } }),
  ];

  function modelFor(item: Fixture): ScreenSchedule {
    return scheduleScreen(item.snapshot, item.config, item.elapsed);
  }

  function reportFor(item: Fixture): FixtureReport {
    const model = modelFor(item);
    return {
      id: item.id, state: item.snapshot.state, page: model.page, language: model.language,
      direction: item.snapshot.direction, station: item.snapshot.station, next: item.snapshot.next,
      sideLabel: model.sideLabel,
      facilityCount: model.station.platformByDirection[item.snapshot.direction]?.facilities.length ?? 0,
    };
  }

  function render(id: string): FixtureReport {
    const item = fixtures.find(candidate => candidate.id === id);
    if (!item) throw new Error(`Unknown Subway browser fixture: ${id}`);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    const started = performance.now();
    renderer.draw(context, 1280, 720, modelFor(item));
    drawCount++;
    renderDurations.push(performance.now() - started);
    return reportFor(item);
  }

  function startStaticProbe(): void {
    staticProbe?.scheduler.dispose();
    staticProbe?.renderer.dispose();
    const probeRenderer = createYamanoteRenderer();
    const pending = new Set<number>();
    const probe = { scheduler: undefined as unknown as SceneScheduler, renderer: probeRenderer,
      requests: 0, executed: 0, cancelled: 0, draws: 0, pending };
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    const model = modelFor(fixtures[0]);
    const request = (callback: FrameRequestCallback) => {
      probe.requests++;
      let frame = 0;
      frame = requestAnimationFrame(time => { pending.delete(frame); probe.executed++; callback(time); });
      pending.add(frame);
      return frame;
    };
    const cancel = (frame: number) => { if (pending.delete(frame)) probe.cancelled++; cancelAnimationFrame(frame); };
    probe.scheduler = new SceneScheduler(() => {
      probe.draws++;
      probeRenderer.draw(context, 1280, 720, model);
      return false;
    }, 'live', request, cancel, () => probeRenderer.dispose());
    staticProbe = probe;
    probe.scheduler.setActive(true);
  }

  function stopStaticProbe(): void {
    staticProbe?.scheduler.dispose();
    staticProbe?.renderer.dispose();
    staticProbe = undefined;
  }

  function metrics(): Record<string, unknown> {
    const sorted = [...renderDurations].sort((a, b) => a - b);
    const percentile = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : 0;
    return {
      logicalSize: '1280x720', devicePixelRatio: window.devicePixelRatio,
      captureDraws: drawCount, captureDrawMs: { p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? 0 },
      widgetOnlyUpdates: widgetOnlyUpdates,
      staticProbe: staticProbe ? {
        requests: staticProbe.requests, executed: staticProbe.executed, cancelled: staticProbe.cancelled,
        pending: staticProbe.pending.size, draws: staticProbe.draws,
      } : null,
    };
  }

  onMount(() => {
    const harnessWindow = window as HarnessWindow;
    harnessWindow.__subwayHarness = {
      manifest: fixtures.map(reportFor), render, startStaticProbe,
      updateWidgetOnly(count: number) { widgetOnlyUpdates += Math.max(0, Math.floor(count)); },
      metrics, stopStaticProbe,
    };
    render('stopped-platform');
    return () => { stopStaticProbe(); renderer.dispose(); delete harnessWindow.__subwayHarness; };
  });
</script>

<canvas bind:this={canvas} width="1280" height="720" aria-hidden="true"></canvas>

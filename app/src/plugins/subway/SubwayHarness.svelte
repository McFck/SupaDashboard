<script lang="ts">
  import { onMount } from 'svelte';
  import { SceneScheduler } from '../../features/skins/scene';
  import { normalizeSubwayLines, stepStation, type LineDefinition, type RawLineBundle } from './lines';
  import { scheduleScreen, type ScreenConfig, type ScreenSchedule } from './screens';
  import { createHibiyaRenderer, scheduleHibiyaPair } from './lcd/hibiya';
  import { createSakaisujiRenderer } from './lcd/sakaisuji';
  import { createYamanoteRenderer } from './lcd/yamanote';
  import { createRunState, reduceRun, segmentPlanKey, snapshotRun,
    type RunPhase, type RunSnapshot, type SubwayCuePlans, type SubwayRunState } from './run';
  import type { PlatformDirectionDetail } from './station-details';

  type Fixture = { id: string; line: LineDefinition; snapshot: RunSnapshot; elapsed: number; config: ScreenConfig };
  type FixtureReport = {
    id: string; line: string; logicalSize: string; state: RunPhase; page: string; language: string; panelLanguages?: [string, string]; direction: string; station: string;
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
  const hibiya = lines.find(line => line.id === 'hibiya')!;
  const sakaisuji = lines.find(line => line.id === 'sakaisuji')!;
  const languages = ['ja', 'en'];
  const fixturePlans: SubwayCuePlans = {
    [segmentPlanKey('yamanote', 'JY01', 'JY02', 'inner')]: {
      close: { events: [], end: 0 },
      open: { events: [], end: 2, open_end: 2 },
      departure: [],
      arrival: [],
    },
  };
  let canvas: HTMLCanvasElement;
  let renderer = createYamanoteRenderer();
  const hibiyaRenderer = createHibiyaRenderer();
  const sakaisujiRenderer = createSakaisujiRenderer();
  let lastLogicalSize = '1280x720';
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
    state = reduceRun(state, { type: 'start' }, 0, lines, fixturePlans).state;
    const phaseTarget: RunPhase = target === 'emergency' || target === 'suspended' ? 'cruising' : target;
    let guard = 0;
    while (state.phase !== phaseTarget && guard++ < 120) {
      const deadline = state.phase === 'stopped' ? state.stopDeadline : state.phaseDeadline;
      if (deadline === null) throw new Error(`No deadline while building ${target} fixture (${state.phase})`);
      let at = state.lastTickAt;
      if (deadline <= at) state = reduceRun(state, { type: 'tick' }, deadline, lines, fixturePlans).state;
      while (at < deadline) {
        at = Math.min(deadline, at + 1_000);
        state = reduceRun(state, { type: 'tick' }, at, lines, fixturePlans).state;
      }
    }
    if (state.phase !== phaseTarget) throw new Error(`Could not build ${target} fixture`);
    if (target === 'emergency' || target === 'suspended') {
      state = reduceRun(state, { type: target === 'emergency' ? 'emergency' : 'suspend' }, state.lastTickAt + 1_000, lines, fixturePlans).state;
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
      Object.freeze({ kind: 'stairs' as const, car: 5, relativePosition: 0.44, label: 'Stairs', source: 'Browser fixture only', revision: 'fixture' }),
      Object.freeze({ kind: 'escalator' as const, car: 6, relativePosition: 0.60, label: 'Escalator', source: 'Browser fixture only', revision: 'fixture' }),
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

  function hibiyaLineWithSide(side: 'left' | 'right' | 'unknown'): LineDefinition {
    const stations = hibiya.stations.map(station => station.code === 'H14'
      ? Object.freeze({ ...station, doorByDirection: Object.freeze({
        ...station.doorByDirection,
        'to-kita-senju': Object.freeze({ side, provenance: 'Browser fixture only', sources: Object.freeze([]), synthetic: true }),
      }) }) : station);
    return Object.freeze({ ...hibiya, stations: Object.freeze(stations) });
  }

  function hibiyaFixture(id: string, state: RunPhase, elapsed = 0, options: {
    direction?: string; station?: string; languages?: string[]; viewingSide?: 'left' | 'right'; line?: LineDefinition;
  } = {}): Fixture {
    const line = options.line ?? hibiya;
    const direction = options.direction ?? 'to-kita-senju';
    const station = options.station ?? 'H14';
    const next = stepStation(line, station, direction)?.code ?? '';
    return {
      id, line, elapsed,
      snapshot: {
        station, next, state, line: 'hibiya', direction, doorSide: 'unknown',
        doors: state === 'stopped' ? 'open' : state === 'arriving' ? 'opening' : 'closed',
        speed: state === 'cruising' ? 48 : state === 'approaching' ? 15 : state === 'departing' ? 6 : 0,
        power: state === 'departing' || state === 'cruising' ? 0.35 : 0, brake: state === 'approaching' ? 0.2 : 0,
        progress: 0.42, paused: false, immersion: false, generation: 1, multiplier: 1, remainingMinutes: 12,
      },
      config: { line, languages: options.languages ?? ['ja', 'en', 'zh', 'ko'], viewingSide: options.viewingSide },
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

  const hibiyaFixtures: Fixture[] = [
    hibiyaFixture('hibiya-stopped-platform', 'stopped', 0, { station: 'H06' }),
    hibiyaFixture('hibiya-stopped-broad', 'stopped', 6_000),
    hibiyaFixture('hibiya-doors-closing', 'doorsClosing'),
    hibiyaFixture('hibiya-departing', 'departing'),
    hibiyaFixture('hibiya-cruising-broad', 'cruising'),
    hibiyaFixture('hibiya-cruising-transfers', 'cruising', 8_000, { station: 'H13' }),
    hibiyaFixture('hibiya-approaching', 'approaching', 0, { station: 'H06' }),
    hibiyaFixture('hibiya-arriving', 'arriving'),
    hibiyaFixture('hibiya-emergency', 'emergency'),
    hibiyaFixture('hibiya-suspended', 'suspended'),
    hibiyaFixture('hibiya-kana', 'cruising', 0, { languages: ['kana', 'en'] }),
    hibiyaFixture('hibiya-chinese-korean', 'cruising', 6_000, { languages: ['zh', 'ko'] }),
    hibiyaFixture('hibiya-reverse', 'cruising', 0, { direction: 'to-naka-meguro' }),
    hibiyaFixture('hibiya-side-this', 'stopped', 0, { line: hibiyaLineWithSide('right'), viewingSide: 'right' }),
    hibiyaFixture('hibiya-side-opposite', 'stopped', 0, { line: hibiyaLineWithSide('right'), viewingSide: 'left' }),
    hibiyaFixture('hibiya-side-unknown', 'stopped', 0, { line: hibiyaLineWithSide('unknown') }),
    hibiyaFixture('hibiya-h22-terminal', 'stopped', 6_000, { station: 'H22' }),
    hibiyaFixture('reference-hibiya-route', 'cruising', 0, { station: 'H13', languages: ['en', 'ja'] }),
  ];

  function sakaisujiLineWithSide(side: 'left' | 'right' | 'unknown'): LineDefinition {
    const stations = sakaisuji.stations.map(station => station.code === 'K15'
      ? Object.freeze({ ...station, doorByDirection: Object.freeze({
        ...station.doorByDirection,
        southbound: Object.freeze({ side, provenance: 'Browser fixture only', sources: Object.freeze([]), synthetic: true }),
      }) }) : station);
    return Object.freeze({ ...sakaisuji, stations: Object.freeze(stations) });
  }

  function sakaisujiFixture(id: string, state: RunPhase, elapsed = 0, options: {
    direction?: string; station?: string; viewingSide?: 'left' | 'right'; line?: LineDefinition; languages?: string[];
  } = {}): Fixture {
    const line = options.line ?? sakaisuji;
    const direction = options.direction ?? 'southbound';
    const station = options.station ?? 'K15';
    return {
      id, line, elapsed,
      snapshot: {
        station, next: stepStation(line, station, direction)?.code ?? '', state, line: 'sakaisuji', direction,
        doorSide: 'unknown', doors: state === 'stopped' ? 'open' : state === 'arriving' ? 'opening' : state === 'doorsClosing' ? 'closing' : 'closed',
        speed: state === 'cruising' ? 42 : state === 'approaching' ? 14 : state === 'departing' ? 6 : 0,
        power: state === 'departing' || state === 'cruising' ? 0.35 : 0, brake: state === 'approaching' ? 0.2 : 0,
        progress: 0.58, paused: false, immersion: false, generation: 1, multiplier: 1, remainingMinutes: 9,
      },
      config: { line, languages: options.languages ?? ['ja', 'kana'], viewingSide: options.viewingSide },
    };
  }

  const sakaisujiTransferStation = sakaisuji.stations.find(station => station.transfers.length > 0)?.code ?? 'K12';
  const sakaisujiFixtures: Fixture[] = [
    sakaisujiFixture('sakaisuji-stopped-platform', 'stopped', 0, { station: 'K11' }),
    sakaisujiFixture('sakaisuji-stopped-nearby', 'stopped', 6_000, { station: 'K12' }),
    sakaisujiFixture('sakaisuji-doors-closing', 'doorsClosing'),
    sakaisujiFixture('sakaisuji-departing', 'departing'),
    sakaisujiFixture('sakaisuji-cruising-broad', 'cruising'),
    sakaisujiFixture('sakaisuji-cruising-nearby', 'cruising', 8_000),
    sakaisujiFixture('sakaisuji-cruising-transfers', 'cruising', 16_000, { station: sakaisujiTransferStation }),
    sakaisujiFixture('sakaisuji-approaching', 'approaching', 0, { station: 'K12' }),
    sakaisujiFixture('sakaisuji-arriving', 'arriving'),
    sakaisujiFixture('sakaisuji-emergency', 'emergency'),
    sakaisujiFixture('sakaisuji-suspended', 'suspended'),
    sakaisujiFixture('sakaisuji-kana', 'cruising', 6_000, { station: 'K12' }),
    sakaisujiFixture('sakaisuji-northbound', 'cruising', 0, { direction: 'northbound' }),
    sakaisujiFixture('sakaisuji-k11-boundary', 'stopped', 0, { station: 'K11', direction: 'northbound' }),
    sakaisujiFixture('sakaisuji-k12-midline', 'stopped', 0, { station: 'K12' }),
    sakaisujiFixture('sakaisuji-k20-boundary', 'stopped', 0, { station: 'K20', direction: 'northbound' }),
    sakaisujiFixture('sakaisuji-side-this', 'stopped', 0, { line: sakaisujiLineWithSide('right'), viewingSide: 'right' }),
    sakaisujiFixture('sakaisuji-side-opposite', 'stopped', 0, { line: sakaisujiLineWithSide('right'), viewingSide: 'left' }),
    sakaisujiFixture('sakaisuji-side-unknown', 'stopped', 0, { line: sakaisujiLineWithSide('unknown') }),
    sakaisujiFixture('reference-hankyu-nearby', 'cruising', 8_000, { station: 'K11', languages: ['ja'] }),
    sakaisujiFixture('reference-hankyu-broad', 'cruising', 0, { station: 'K11', languages: ['kana'] }),
  ];

  function modelFor(item: Fixture): ScreenSchedule {
    return scheduleScreen(item.snapshot, item.config, item.elapsed);
  }

  function reportFor(item: Fixture): FixtureReport {
    const model = modelFor(item);
    return {
      id: item.id, line: item.line.id,
      logicalSize: item.line.id === 'hibiya' ? '2592x720' : item.line.id === 'sakaisuji' ? '1920x540' : '1280x720',
      state: item.snapshot.state, page: model.page, language: model.language,
      direction: item.snapshot.direction, station: item.snapshot.station, next: item.snapshot.next,
      sideLabel: model.sideLabel,
      facilityCount: model.station.platformByDirection[item.snapshot.direction]?.facilities.length ?? 0,
      ...(item.line.id === 'hibiya' ? { panelLanguages: [
        scheduleHibiyaPair(item.snapshot, item.config, item.elapsed).left.language,
        scheduleHibiyaPair(item.snapshot, item.config, item.elapsed).right.language,
      ] as [string, string] } : {}),
    };
  }

  function render(id: string): FixtureReport {
    const item = [...fixtures, ...hibiyaFixtures, ...sakaisujiFixtures].find(candidate => candidate.id === id);
    if (!item) throw new Error(`Unknown Subway browser fixture: ${id}`);
    const logicalWidth = item.line.id === 'hibiya' ? 2592 : item.line.id === 'sakaisuji' ? 1920 : 1280;
    const logicalHeight = item.line.id === 'sakaisuji' ? 540 : 720;
    canvas.width = logicalWidth;
    canvas.height = logicalHeight;
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    lastLogicalSize = `${logicalWidth}x${logicalHeight}`;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    const started = performance.now();
    if (item.line.id === 'hibiya') {
      hibiyaRenderer.draw(context, logicalWidth, 720, scheduleHibiyaPair(item.snapshot, item.config, item.elapsed));
    } else if (item.line.id === 'sakaisuji') sakaisujiRenderer.draw(context, logicalWidth, logicalHeight, modelFor(item));
    else renderer.draw(context, logicalWidth, logicalHeight, modelFor(item));
    drawCount++;
    renderDurations.push(performance.now() - started);
    return reportFor(item);
  }

  function startStaticProbe(): void {
    staticProbe?.scheduler.dispose();
    staticProbe?.renderer.dispose();
    canvas.width = 1280;
    canvas.height = 720;
    canvas.style.width = '1280px';
    canvas.style.height = '720px';
    lastLogicalSize = '1280x720';
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
      logicalSize: lastLogicalSize, devicePixelRatio: window.devicePixelRatio,
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
      manifest: [...fixtures, ...hibiyaFixtures, ...sakaisujiFixtures].map(reportFor), render, startStaticProbe,
      updateWidgetOnly(count: number) { widgetOnlyUpdates += Math.max(0, Math.floor(count)); },
      metrics, stopStaticProbe,
    };
    render('stopped-platform');
    return () => { stopStaticProbe(); renderer.dispose(); hibiyaRenderer.dispose(); sakaisujiRenderer.dispose(); delete harnessWindow.__subwayHarness; };
  });
</script>

<canvas bind:this={canvas} width="1280" height="720" aria-hidden="true"></canvas>

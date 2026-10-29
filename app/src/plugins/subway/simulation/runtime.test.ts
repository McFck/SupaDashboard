import { afterEach, describe, expect, it, vi } from 'vitest';
import { get, readable, writable } from 'svelte/store';
import type { AppletRuntimeContext } from '../../../features/applets/contracts';
import type { RawLineBundle } from './lines';
import {
  registerSubwaySurface,
  createSubwayRuntime,
  subwaySceneState,
  type SubwayRuntimeClock,
} from './runtime';
import type { DoorSequenceApi, LoadedSubwayAssets, RuntimeCueManifest } from '../audio/sound-pack';
import type { SubwayAudioController } from '../audio/audio';

const files = import.meta.glob('../../../../../assets/lines/*/{line,pack}.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const bundles: Record<string, RawLineBundle> = {};
for (const [path, value] of Object.entries(files)) {
  const id = path.includes('/yamanote/')
    ? 'yamanote'
    : path.includes('/hibiya/')
      ? 'hibiya'
      : path.includes('/sakaisuji/')
        ? 'sakaisuji'
        : undefined;
  if (!id) continue;
  bundles[id] ??= { line: undefined, pack: undefined };
  if (path.endsWith('/line.json')) bundles[id].line = value;
  else bundles[id].pack = value;
}
const catalogue = Object.values(
  import.meta.glob('../../../../../assets/motion/runtime-cues.json', {
    eager: true,
    import: 'default',
  }) as Record<string, RuntimeCueManifest>,
)[0];
const doorSequence: DoorSequenceApi = {
  plan: () => ({ events: [], end: 1, close_end: 0.8, open_end: 0.7 }),
};
const assets: LoadedSubwayAssets = {
  catalogue,
  lines: bundles as unknown as LoadedSubwayAssets['lines'],
  doorSequence,
};

class FakeClock implements SubwayRuntimeClock {
  nowMs = 0;
  nextId = 1;
  timers = new Map<number, { at: number; callback: () => void }>();
  now(): number {
    return this.nowMs;
  }
  setTimeout(callback: () => void, delay: number): number {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + Math.max(0, delay), callback });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  get pending(): number {
    return this.timers.size;
  }
  advanceBy(duration: number): void {
    const target = this.nowMs + duration;
    let turns = 0;
    while (true) {
      const next = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      if (++turns > 10_000) throw new Error('Fake clock exceeded timer guard');
      this.timers.delete(next[0]);
      this.nowMs = next[1].at;
      next[1].callback();
    }
    this.nowMs = target;
  }
  advanceUntil(predicate: () => boolean, timeoutMs = 5 * 60_000): void {
    const deadline = this.nowMs + timeoutMs;
    while (!predicate() && this.nowMs < deadline) {
      // Keep each simulated tick below the run reducer's hidden-gap stall guard.
      this.advanceBy(Math.min(250, deadline - this.nowMs));
    }
    if (!predicate()) throw new Error(`Subway state was not reached within ${timeoutMs}ms`);
  }
}

function makeContext(onEvent?: (id: string) => void) {
  const config = writable({
    line: 'yamanote',
    direction: 'inner',
    station: 'JY30',
    speed: 1,
    immersion: true,
    dwellSeconds: 0,
  });
  const values = new Map<string, unknown>();
  const events: string[] = [];
  const ancestries: Array<{ depth: number; listeners: string[] } | undefined> = [];
  const context: AppletRuntimeContext = {
    config,
    active: readable(true),
    getState: (key) => values.get(key) as never,
    setState: async (key, value) => {
      values.set(key, value);
      return true;
    },
    setView: async () => true,
    emitEvent: async (id, _parameter, _payload, ancestry) => {
      events.push(id);
      ancestries.push(ancestry);
      onEvent?.(id);
    },
  };
  return { context, values, events, ancestries, config };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 32; i++) await Promise.resolve();
}

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe('Subway owner runtime', () => {
  it.each(['emergency', 'suspend'] as const)(
    'settles a moving %s, publishes exact zero and resumes from an idle owner',
    async (type) => {
      const clock = new FakeClock();
      const fixture = makeContext();
      const surface = registerSubwaySurface(true);
      disposers.push(() => surface.dispose());
      const handle = createSubwayRuntime(fixture.context, {
        clock,
        loadAssets: async () => assets,
        assetBase: 'http://localhost/subway/',
      });
      disposers.push(() => handle.dispose());
      await flush();
      clock.advanceUntil(() => handle.getSnapshot()?.state === 'departing');
      await flush();
      clock.advanceBy(20);
      const speed = handle.getSnapshot()!.speed;
      expect(speed).toBeGreaterThan(0);
      expect(speed).toBeLessThan(2);
      handle.dispatch({ type });
      await flush();
      clock.advanceBy(3_200);
      await flush();
      expect(clock.pending).toBe(0);
      expect(handle.getSnapshot()!.speed).toBe(0);
      expect(fixture.values.get('speed')).toBe(0);
      expect(get(subwaySceneState)?.snapshot.speed).toBe(0);
      clock.advanceBy(20_000);
      expect(clock.pending).toBe(0);
      expect(handle.dispatch({ type: 'resume-service' })).toBe(true);
      await flush();
      expect(handle.getSnapshot()!.state).toBe('departing');
      expect(clock.pending).toBe(1);
    },
  );
  it('starts automatically on the first eligible runtime surface and publishes the owner projection', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    fixture.config.update((config) => ({ ...config, dwellSeconds: 15 }));
    const handle = createSubwayRuntime(fixture.context, {
      clock,
      loadAssets: async () => assets,
      assetBase: 'http://localhost/subway/',
    });
    disposers.push(() => handle.dispose());
    await flush();
    expect(handle.isReady()).toBe(true);
    expect(clock.pending).toBe(0);
    expect(handle.dispatch({ type: 'start' })).toBe(false);

    const surface = registerSubwaySurface(true);
    disposers.push(() => surface.dispose());
    await flush();
    expect(clock.pending).toBe(1);
    expect(fixture.values.get('station')).toBe('JY30');
    expect(fixture.values.get('paused')).toBe(false);
    clock.advanceBy(15_000);
    await flush();
    expect(handle.getSnapshot()).toMatchObject({
      state: 'doorsClosing',
      station: 'JY30',
      next: 'JY01',
    });
    expect(clock.pending).toBe(1);
    surface.dispose();
    expect(clock.pending).toBe(0);
  });

  it('auto-starts after an editor-only period and preserves the progressed station across hide/show', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    fixture.config.update((config) => ({ ...config, startStation: 'JY01', dwellSeconds: 0 }));
    const surface = registerSubwaySurface(false);
    disposers.push(() => surface.dispose());
    const handle = createSubwayRuntime(fixture.context, {
      clock,
      loadAssets: async () => assets,
      assetBase: 'http://localhost/subway/',
    });
    disposers.push(() => handle.dispose());
    await flush();
    expect(clock.pending).toBe(0);

    surface.setEligible(true);
    await flush();
    expect(handle.getSnapshot()).toMatchObject({ station: 'JY01', next: 'JY02', paused: false });
    expect(clock.pending).toBe(1);

    clock.advanceUntil(() => handle.getSnapshot()?.station === 'JY02');
    await flush();
    expect(handle.getSnapshot()).toMatchObject({ station: 'JY02', next: 'JY03' });
    surface.setEligible(false);
    const hidden = handle.getSnapshot()!;
    clock.advanceBy(60_000);
    expect(handle.getSnapshot()).toMatchObject({
      station: 'JY02',
      progress: hidden.progress,
      state: hidden.state,
    });

    surface.setEligible(true);
    await flush();
    expect(handle.getSnapshot()).toMatchObject({ station: 'JY02', next: 'JY03', paused: false });
    clock.advanceUntil(() => handle.getSnapshot()?.station === 'JY03');
    await flush();
    expect(handle.getSnapshot()).toMatchObject({ station: 'JY03' });
  });

  it('freezes on the last eligible surface and resumes one shared controller when another surface remains', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    const first = registerSubwaySurface(true);
    const second = registerSubwaySurface(true);
    disposers.push(
      () => first.dispose(),
      () => second.dispose(),
    );
    const handle = createSubwayRuntime(fixture.context, {
      clock,
      loadAssets: async () => assets,
      assetBase: 'http://localhost/subway/',
    });
    disposers.push(() => handle.dispose());
    await flush();
    handle.dispatch({ type: 'start' });
    clock.advanceBy(15_600 + 4_000);
    await flush();
    const before = handle.getSnapshot()!;
    expect(clock.pending).toBe(1);
    first.setEligible(false);
    expect(clock.pending).toBe(1);
    second.setEligible(false);
    expect(clock.pending).toBe(0);
    const frozen = handle.getSnapshot()!;
    clock.advanceBy(60_000);
    expect(handle.getSnapshot()).toMatchObject({
      progress: frozen.progress,
      speed: frozen.speed,
      station: frozen.station,
      state: frozen.state,
    });
    second.setEligible(true);
    expect(clock.pending).toBe(1);
    clock.advanceBy(30_000);
    await flush();
    expect(handle.getSnapshot()!.progress).toBeGreaterThan(before.progress);
  });

  it('does not install a timer when a surface is an editor preview or becomes hidden', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    const surface = registerSubwaySurface(false);
    disposers.push(() => surface.dispose());
    const handle = createSubwayRuntime(fixture.context, {
      clock,
      loadAssets: async () => assets,
      assetBase: 'http://localhost/subway/',
    });
    disposers.push(() => handle.dispose());
    await flush();
    expect(handle.dispatch({ type: 'start' })).toBe(false);
    expect(clock.pending).toBe(0);
    surface.setEligible(true);
    await flush();
    expect(clock.pending).toBe(1);
    expect(handle.getSnapshot()).toMatchObject({ station: 'JY30', next: 'JY01', paused: false });
    surface.setEligible(false);
    await flush();
    expect(clock.pending).toBe(0);
    expect(fixture.values.get('paused')).toBe(true);
  });

  it('projects unavailable after asset loading fails before a surface becomes eligible', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    const handle = createSubwayRuntime(fixture.context, {
      clock,
      loadAssets: async () => {
        throw new Error('missing asset');
      },
    });
    disposers.push(() => handle.dispose());
    await flush();
    expect(fixture.values.size).toBe(0);
    const surface = registerSubwaySurface(true);
    disposers.push(() => surface.dispose());
    await flush();
    expect(fixture.values.get('state')).toBe('unavailable');
    expect(fixture.values.get('paused')).toBe(true);
    expect(clock.pending).toBe(0);
  });

  it('ignores late asset completion after owner disposal', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    const surface = registerSubwaySurface(true);
    disposers.push(() => surface.dispose());
    let resolveAssets!: (loaded: LoadedSubwayAssets) => void;
    const handle = createSubwayRuntime(fixture.context, {
      clock,
      loadAssets: () =>
        new Promise((resolve) => {
          resolveAssets = resolve;
        }),
    });
    handle.dispose();
    resolveAssets(assets);
    await flush();
    expect(handle.isReady()).toBe(false);
    expect(clock.pending).toBe(0);
    expect(fixture.values.size).toBe(0);
  });

  it('checks the run generation after reentrant lifecycle events', async () => {
    const clock = new FakeClock();
    let handle: ReturnType<typeof createSubwayRuntime> | undefined;
    const fixture = makeContext((id) => {
      if (id === 'subway.departed')
        handle?.dispatch({ type: 'set-line', lineId: 'hibiya', stationCode: 'H14' });
    });
    const surface = registerSubwaySurface(true);
    disposers.push(() => surface.dispose());
    handle = createSubwayRuntime(fixture.context, {
      clock,
      loadAssets: async () => assets,
      assetBase: 'http://localhost/subway/',
    });
    disposers.push(() => handle!.dispose());
    await flush();
    handle.dispatch({ type: 'start' });
    clock.advanceBy(25_000);
    await flush();
    expect(fixture.events).toContain('subway.departed');
    expect(handle.getSnapshot()).toMatchObject({
      line: 'hibiya',
      station: 'H14',
      state: 'stopped',
    });
  });

  it('keeps runtime line and immersion overrides through unrelated config changes, then clears each on its own setting edit', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    const surface = registerSubwaySurface(true);
    disposers.push(() => surface.dispose());
    const handle = createSubwayRuntime(fixture.context, {
      clock,
      loadAssets: async () => assets,
      assetBase: 'http://localhost/subway/',
    });
    disposers.push(() => handle.dispose());
    await flush();
    expect(
      handle.requestLine({ line: 'hibiya', direction: 'to-kita-senju', startStation: 'H14' }),
    ).toBe(true);
    expect(handle.getSnapshot()).toMatchObject({
      line: 'hibiya',
      direction: 'to-kita-senju',
      station: 'H14',
      next: 'H15',
      paused: false,
      generation: 3,
    });
    expect(handle.setImmersion(false)).toBe(true);
    fixture.config.update((config) => ({ ...config, speed: 2 }));
    expect(handle.getSnapshot()).toMatchObject({
      line: 'hibiya',
      station: 'H14',
      immersion: false,
      multiplier: 2,
    });
    fixture.config.update((config) => ({ ...config, immersion: false }));
    fixture.config.update((config) => ({
      ...config,
      line: 'hibiya',
      direction: 'to-naka-meguro',
      startStation: 'H06',
    }));
    expect(handle.getSnapshot()).toMatchObject({
      line: 'hibiya',
      direction: 'to-naka-meguro',
      station: 'H06',
      next: 'H05',
      immersion: false,
      paused: false,
    });
  });

  it('keeps a completed non-loop terminal stopped across hide/show and starts after an explicit new route', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    fixture.config.update((config) => ({
      ...config,
      line: 'hibiya',
      direction: 'to-naka-meguro',
      station: 'H02',
      dwellSeconds: 0,
    }));
    const surface = registerSubwaySurface(true);
    disposers.push(() => surface.dispose());
    const handle = createSubwayRuntime(fixture.context, {
      clock,
      loadAssets: async () => assets,
      assetBase: 'http://localhost/subway/',
    });
    disposers.push(() => handle.dispose());
    await flush();
    clock.advanceUntil(() => handle.getSnapshot()?.station === 'H01' && clock.pending === 0);
    await flush();
    expect(handle.getSnapshot()).toMatchObject({
      line: 'hibiya',
      station: 'H01',
      next: '',
      state: 'stopped',
      paused: false,
    });
    expect(clock.pending).toBe(0);

    surface.setEligible(false);
    surface.setEligible(true);
    await flush();
    expect(handle.getSnapshot()).toMatchObject({
      line: 'hibiya',
      station: 'H01',
      next: '',
      state: 'stopped',
      paused: false,
    });
    expect(clock.pending).toBe(0);

    expect(
      handle.requestLine({ line: 'sakaisuji', direction: 'southbound', startStation: 'K11' }),
    ).toBe(true);
    expect(handle.getSnapshot()).toMatchObject({
      line: 'sakaisuji',
      direction: 'southbound',
      station: 'K11',
      next: 'K12',
      paused: false,
    });
    expect(clock.pending).toBe(1);
  });

  it('passes scenario ancestry through runtime action events and rejects invalid requested station data without mutation', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    const surface = registerSubwaySurface(true);
    disposers.push(() => surface.dispose());
    const handle = createSubwayRuntime(fixture.context, {
      clock,
      loadAssets: async () => assets,
      assetBase: 'http://localhost/subway/',
    });
    disposers.push(() => handle.dispose());
    await flush();
    const before = handle.getSnapshot();
    expect(
      handle.requestLine({ line: 'hibiya', direction: 'to-kita-senju', startStation: 'K20' }),
    ).toBe(false);
    expect(handle.getSnapshot()).toEqual(before);
    const ancestry = { depth: 2, listeners: ['flow-1', 'flow-2'] };
    expect(handle.dispatch({ type: 'emergency' }, ancestry)).toBe(true);
    await flush();
    expect(fixture.events).toContain('subway.emergency');
    expect(fixture.ancestries).toContainEqual(ancestry);
  });

  it('keeps audio inside the eligible owner runtime and unlocks only through immersion commands', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    const surface = registerSubwaySurface(true);
    disposers.push(() => surface.dispose());
    const audio: SubwayAudioController = {
      setEnabled: vi.fn(),
      resetLine: vi.fn(),
      setVisible: vi.fn(),
      setMix: vi.fn(),
      setAnnouncementVolume: vi.fn(),
      transition: vi.fn(),
      preload: vi.fn(),
      playCue: vi.fn(async () => {}),
      getStats: () => ({
        activeSources: 0,
        decodedCacheBytes: 0,
        decodedCachePeakBytes: 0,
        cacheHits: 0,
        syntheticEmergencyAlert: true,
      }),
      dispose: vi.fn(),
    };
    const handle = createSubwayRuntime(fixture.context, {
      clock,
      loadAssets: async () => assets,
      assetBase: 'http://localhost/subway/',
      audio,
    });
    disposers.push(() => handle.dispose());
    await flush();
    expect(audio.setVisible).toHaveBeenCalledWith(true);
    expect(audio.setEnabled).toHaveBeenCalledWith(true);
    expect(handle.setImmersion(true)).toBe(true);
    expect(audio.setEnabled).toHaveBeenCalledWith(true, true);
    expect(handle.dispatch({ type: 'start' })).toBe(true);
    expect(audio.transition).toHaveBeenCalled();
    expect(handle.requestLine({ line: 'hibiya', startStation: 'H14' })).toBe(true);
    expect(audio.resetLine).toHaveBeenCalledWith(true);
    surface.setEligible(false);
    expect(audio.setVisible).toHaveBeenLastCalledWith(false);
    handle.dispose();
    expect(audio.dispose).toHaveBeenCalledOnce();
  });
});

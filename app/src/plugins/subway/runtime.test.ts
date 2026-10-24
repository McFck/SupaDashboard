import { afterEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import type { SkinRuntimeContext } from '../../core/skins';
import { normalizeSubwayLines, type RawLineBundle } from './lines';
import { registerSubwaySurface, createSubwayRuntime, type SubwayRuntimeClock } from './runtime';
import type { DoorSequenceApi, LoadedSubwayAssets, RuntimeCueManifest } from './sound-pack';

const files = import.meta.glob('../../../../assets/lines/*/{line,pack}.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const bundles: Record<string, RawLineBundle> = {};
for (const [path, value] of Object.entries(files)) {
  const id = path.includes('/yamanote/') ? 'yamanote' : path.includes('/hibiya/') ? 'hibiya' : path.includes('/sakaisuji/') ? 'sakaisuji' : undefined;
  if (!id) continue;
  bundles[id] ??= { line: undefined, pack: undefined };
  if (path.endsWith('/line.json')) bundles[id].line = value;
  else bundles[id].pack = value;
}
const catalogue = Object.values(import.meta.glob('../../../../assets/motion/runtime-cues.json', { eager: true, import: 'default' }) as Record<string, RuntimeCueManifest>)[0];
const doorSequence: DoorSequenceApi = { plan: () => ({ events: [], end: 1, close_end: 0.8, open_end: 0.7 }) };
const assets: LoadedSubwayAssets = { catalogue, lines: bundles as unknown as LoadedSubwayAssets['lines'], doorSequence };

class FakeClock implements SubwayRuntimeClock {
  nowMs = 0;
  nextId = 1;
  timers = new Map<number, { at: number; callback: () => void }>();
  now(): number { return this.nowMs; }
  setTimeout(callback: () => void, delay: number): number {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + Math.max(0, delay), callback });
    return id;
  }
  clearTimeout(handle: unknown): void { this.timers.delete(handle as number); }
  get pending(): number { return this.timers.size; }
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
}

function makeContext(onEvent?: (id: string) => void) {
  const config = writable({ line: 'yamanote', direction: 'inner', station: 'JY30', speed: 1, immersion: true, dwellSeconds: 0 });
  const values = new Map<string, unknown>();
  const events: string[] = [];
  const context: SkinRuntimeContext = {
    config,
    getState: key => values.get(key) as never,
    setState: async (key, value) => { values.set(key, value); return true; },
    setView: async () => true,
    emitEvent: async id => { events.push(id); onEvent?.(id); },
  };
  return { context, values, events, config };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 32; i++) await Promise.resolve();
}

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe('Subway owner runtime', () => {
  it('waits for an eligible runtime surface, then uses one timer and publishes the owner projection', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    fixture.config.update(config => ({ ...config, dwellSeconds: 15 }));
    const handle = createSubwayRuntime(fixture.context, { clock, loadAssets: async () => assets, assetBase: 'http://localhost/subway/' });
    disposers.push(() => handle.dispose());
    await flush();
    expect(handle.isReady()).toBe(true);
    expect(clock.pending).toBe(0);
    expect(handle.dispatch({ type: 'start' })).toBe(false);

    const surface = registerSubwaySurface(true);
    disposers.push(() => surface.dispose());
    await flush();
    expect(clock.pending).toBe(0);
    expect(fixture.values.get('station')).toBe('JY30');
    expect(handle.dispatch({ type: 'start' })).toBe(true);
    expect(clock.pending).toBe(1);
    clock.advanceBy(15_000);
    await flush();
    expect(handle.getSnapshot()).toMatchObject({ state: 'doorsClosing', station: 'JY30', next: 'JY01' });
    expect(clock.pending).toBe(1);
    surface.dispose();
    expect(clock.pending).toBe(0);
  });

  it('freezes on the last eligible surface and resumes one shared controller when another surface remains', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    const first = registerSubwaySurface(true);
    const second = registerSubwaySurface(true);
    disposers.push(() => first.dispose(), () => second.dispose());
    const handle = createSubwayRuntime(fixture.context, { clock, loadAssets: async () => assets, assetBase: 'http://localhost/subway/' });
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
    expect(handle.getSnapshot()).toMatchObject({ progress: frozen.progress, speed: frozen.speed, station: frozen.station, state: frozen.state });
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
    const handle = createSubwayRuntime(fixture.context, { clock, loadAssets: async () => assets, assetBase: 'http://localhost/subway/' });
    disposers.push(() => handle.dispose());
    await flush();
    expect(handle.dispatch({ type: 'start' })).toBe(false);
    expect(clock.pending).toBe(0);
    surface.setEligible(true);
    await flush();
    handle.dispatch({ type: 'start' });
    expect(clock.pending).toBe(1);
    surface.setEligible(false);
    await flush();
    expect(clock.pending).toBe(0);
    expect(fixture.values.get('paused')).toBe(true);
  });

  it('projects unavailable after asset loading fails before a surface becomes eligible', async () => {
    const clock = new FakeClock();
    const fixture = makeContext();
    const handle = createSubwayRuntime(fixture.context, { clock, loadAssets: async () => { throw new Error('missing asset'); } });
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
    const handle = createSubwayRuntime(fixture.context, { clock, loadAssets: () => new Promise(resolve => { resolveAssets = resolve; }) });
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
    const fixture = makeContext(id => {
      if (id === 'subway.departed') handle?.dispatch({ type: 'set-line', lineId: 'hibiya', stationCode: 'H14' });
    });
    const surface = registerSubwaySurface(true);
    disposers.push(() => surface.dispose());
    handle = createSubwayRuntime(fixture.context, { clock, loadAssets: async () => assets, assetBase: 'http://localhost/subway/' });
    disposers.push(() => handle!.dispose());
    await flush();
    handle.dispatch({ type: 'start' });
    clock.advanceBy(25_000);
    await flush();
    expect(fixture.events).toContain('subway.departed');
    expect(handle.getSnapshot()).toMatchObject({ line: 'hibiya', station: 'H14', state: 'stopped' });
  });
});

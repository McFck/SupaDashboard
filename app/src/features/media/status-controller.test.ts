import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControlConfig } from '../controls/model';
import type { NowPlayingSourceState, StatusSourceDef } from '../plugins/contracts';
import { StatusController } from './status-controller';

type Fake = StatusSourceDef & {
  emit(state: NowPlayingSourceState): void;
  starts: number;
  stops: number;
};
function fake(id: string, throws = false): Fake {
  const source: Fake = {
    id,
    title: id,
    kind: 'nowPlaying',
    mediaSourceId: id,
    starts: 0,
    stops: 0,
    emit: () => {},
    subscribe(emit) {
      source.starts++;
      if (throws) {
        throw new Error('boom');
      }
      source.emit = emit;
      return () => void source.stops++;
    },
  };
  return source;
}
const widget = (id: string, sources: string[] = []): ControlConfig => ({
  id,
  name: id,
  type: 'nowPlaying',
  options: { sources },
  variants: [],
});
const track = (sessionId: string, title = 'Song') => ({
  sessionId,
  title,
  artist: 'Band',
  album: '',
  state: 'playing' as const,
  current: true,
});
function setup(...sources: Fake[]) {
  const onChange = vi.fn();
  const controller = new StatusController({
    sources: new Map(sources.map((source) => [source.id, source])),
    onChange,
    resolveArtwork: async () => null,
  });
  return { controller, onChange };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('status ownership', () => {
  it('runs one subscription per source however many widgets show it, and releases it with the last', () => {
    const system = fake('system');
    const { controller } = setup(system);
    controller.reconcile([widget('a'), widget('b')], new Set(['a', 'b']));
    expect(system.starts).toBe(1);
    controller.reconcile([widget('a')], new Set(['a']));
    expect(system.stops).toBe(0);
    controller.reconcile([widget('a')], new Set());
    expect(system.stops).toBe(1);
  });

  it('ignores emissions that arrive after disposal', () => {
    const system = fake('system');
    const { controller, onChange } = setup(system);
    controller.reconcile([widget('a')], new Set(['a']));
    const late = system.emit;
    controller.dispose();
    onChange.mockClear();
    late({ state: 'ready', sessions: [track('x')] });
    expect(onChange).not.toHaveBeenCalled();
    expect(controller.snapshot().widgets).toEqual({});
  });

  it('publishes the picked session per widget and addresses it exactly', () => {
    const system = fake('system');
    const spotify = fake('spotify');
    const { controller } = setup(system, spotify);
    controller.reconcile([widget('a', ['spotify'])], new Set(['a']));
    system.emit({ state: 'ready', sessions: [track('other')] });
    spotify.emit({ state: 'ready', sessions: [track('s#1', 'Mine')] });
    expect(controller.target('a')).toEqual({ sourceId: 'spotify', sessionId: 's#1' });
    expect(controller.snapshot().widgets.a.candidate?.session.title).toBe('Mine');
  });

  it('keeps other sources working when one fails, and retries the failed one until disposed', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const system = fake('system');
    const broken = fake('broken', true);
    const { controller } = setup(system, broken);
    controller.reconcile([widget('a'), widget('b', ['broken'])], new Set(['a', 'b']));
    system.emit({ state: 'ready', sessions: [track('x')] });
    expect(controller.snapshot().widgets.a.candidate?.session.sessionId).toBe('x');
    expect(controller.snapshot().widgets.b.unavailable).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(broken.starts).toBe(2);
    controller.dispose();
    vi.advanceTimersByTime(60_000);
    expect(broken.starts).toBe(2);
  });

  it('shows a saved filter whose source is missing as empty, never as another source', () => {
    const system = fake('system');
    const { controller } = setup(system);
    controller.reconcile([widget('a', ['gone'])], new Set(['a']));
    system.emit({ state: 'ready', sessions: [track('x')] });
    expect(controller.snapshot().widgets.a).toEqual({ unavailable: false });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EffectRuntime, validTileEffects } from './effect-runtime';
import { isTriggerPacket } from '../automation/capture';
import {
  ScenarioRunner,
  type RunnerServices,
  type TriggerPacket,
} from '../automation/scenario-runner';

const packet = (trigger: TriggerPacket['trigger'] = 'longPress'): TriggerPacket => ({
  controlId: 'control',
  itemId: 'tile',
  interactionId: 'hold',
  sourceStateId: 'on',
  capturedAt: 0,
  trigger,
  effect: 'hearts',
  steps: [],
});
afterEach(() => {
  vi.useRealTimers();
});

describe('tile effect ownership', () => {
  it('rejects malformed captures and effect snapshots before they reach a tile', () => {
    expect(isTriggerPacket(packet())).toBe(true);
    for (const invalid of [
      { effect: 'unknown' },
      { origin: { x: Infinity, y: 0 } },
      { steps: [{ id: 'bad', kind: 'delay', ms: -1 }] },
    ]) {
      expect(isTriggerPacket({ ...packet(), ...invalid })).toBe(false);
    }
    const effect = {
      id: 1,
      tileId: 'tile',
      controlId: 'control',
      effect: 'snow',
      loop: true,
      stopping: false,
    };
    expect(validTileEffects([effect])).toBe(true);
    for (const invalid of [
      [{ ...effect, effect: 'unknown' }],
      [{ ...effect, origin: { x: -1, y: 0 } }],
      [effect, effect],
      [effect, { ...effect, id: 2 }, { ...effect, id: 3 }],
    ]) {
      expect(validTileEffects(invalid)).toBe(false);
    }
  });
  it('ends recognised holds on release or cancel and frees all one-shot resources', () => {
    vi.useFakeTimers();
    const runtime = new EffectRuntime(() => {});
    const captured = packet();
    runtime.hold(captured);
    runtime.start(captured, 'hearts');
    expect(runtime.snapshot()).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(runtime.snapshot()[0].stopping).toBe(false);
    runtime.end('hold');
    expect(runtime.snapshot()[0].stopping).toBe(true);
    vi.advanceTimersByTime(200);
    expect(runtime.snapshot()).toEqual([]);
    runtime.start(packet('press'), 'ripple');
    vi.advanceTimersByTime(1000);
    expect(runtime.snapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears completed action loops on page change and never exceeds two effects per tile', () => {
    vi.useFakeTimers();
    const runtime = new EffectRuntime(() => {});
    runtime.hold({ ...packet(), effect: undefined });
    for (const effect of ['fire', 'snow', 'sparkles'] as const) {
      runtime.start(packet(), effect);
    }
    expect(runtime.snapshot()).toHaveLength(2);
    runtime.clear();
    expect(runtime.snapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    runtime.start(packet(), 'lightning');
    expect(runtime.snapshot()[0].loop).toBe(false);
    runtime.clear();
  });

  it('starts an action effect only at its step and stops it when execution is aborted', async () => {
    vi.useFakeTimers();
    const runtime = new EffectRuntime(() => {});
    const services: RunnerServices = {
      runAction: () => new Promise(() => {}),
      getVariable: () => undefined,
      findVariable: () => undefined,
      setVariable: async () => true,
      getState: () => 'on',
      setState: () => {},
      emitEvent: async () => {},
      effect: (captured, effect, signal) => runtime.start(captured, effect, signal),
    };
    const captured: TriggerPacket = {
      ...packet(),
      effect: undefined,
      steps: [
        { id: 'wait', kind: 'delay', ms: 100 },
        { id: 'open', kind: 'action', action: { id: 'app.open' }, effect: 'lightning' },
      ],
    };
    runtime.hold(captured);
    const controller = new AbortController();
    const run = new ScenarioRunner(services).run(captured, controller.signal);
    expect(runtime.snapshot()).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(runtime.snapshot()[0]).toMatchObject({
      effect: 'lightning',
      loop: true,
      tileId: 'tile',
    });
    controller.abort();
    expect((await run).status).toBe('cancelled');
    runtime.end('hold');
    await vi.advanceTimersByTimeAsync(200);
    expect(runtime.snapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

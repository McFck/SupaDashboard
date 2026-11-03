import { afterEach, describe, expect, it, vi } from 'vitest';
import { EffectRuntime, releasePullEffects, validTileEffects } from './effect-runtime';
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

  it.each(['swipeUp', 'swipeDown', 'swipeLeft', 'swipeRight'] as const)(
    'previews action effects for an armed %s without duplicate loops',
    (trigger) => {
      vi.useFakeTimers();
      const runtime = new EffectRuntime(() => {});
      const captured: TriggerPacket = {
        ...packet(trigger),
        effect: undefined,
        steps: [{ id: 'action', kind: 'action', action: { id: 'open' }, effect: 'hearts' }],
      };
      runtime.hold(captured);
      runtime.hold(captured);
      runtime.start(captured, 'hearts');
      vi.advanceTimersByTime(4000);
      expect(runtime.snapshot()).toMatchObject([{ effect: 'hearts', loop: true, stopping: false }]);
      runtime.end(captured.interactionId);
      vi.advanceTimersByTime(200);
      expect(runtime.snapshot()).toEqual([]);
      runtime.hold(captured);
      expect(runtime.snapshot()).toMatchObject([{ effect: 'hearts', loop: true, stopping: false }]);
      runtime.clear();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not replay pull effects when delayed actions run after the preview has faded', async () => {
    vi.useFakeTimers();
    const runtime = new EffectRuntime(() => {});
    const runAction = vi.fn();
    const captured: TriggerPacket = {
      ...packet('swipeUp'),
      effect: undefined,
      steps: [
        { id: 'wait', kind: 'delay', ms: 1000 },
        { id: 'first', kind: 'action', action: { id: 'open' }, effect: 'hearts' },
        {
          id: 'branch',
          kind: 'if',
          condition: {
            kind: 'compare',
            left: { kind: 'literal', value: 1 },
            op: 'eq',
            right: { kind: 'literal', value: 1 },
          },
          then: [{ id: 'second', kind: 'action', action: { id: 'close' }, effect: 'snow' }],
          else: [],
        },
      ],
    };
    const original = structuredClone(captured);
    runtime.hold(captured);
    expect(runtime.snapshot().map((effect) => effect.effect)).toEqual(['hearts', 'snow']);
    const released = releasePullEffects(captured);
    runtime.end(captured.interactionId);
    const runner = new ScenarioRunner({
      runAction,
      getVariable: () => undefined,
      findVariable: () => undefined,
      setVariable: async () => true,
      getState: () => 'on',
      setState: () => {},
      emitEvent: async () => {},
      effect: (source, effect, signal) => runtime.start(source, effect, signal),
    });
    const run = runner.run(released);
    await vi.advanceTimersByTimeAsync(1200);
    expect((await run).status).toBe('completed');
    expect(runAction).toHaveBeenCalledTimes(2);
    expect(runtime.snapshot()).toEqual([]);
    expect(captured).toEqual(original);
    expect(vi.getTimerCount()).toBe(0);
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

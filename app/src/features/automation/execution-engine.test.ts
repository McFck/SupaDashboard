import { describe, expect, it } from 'vitest';
import { ExecutionEngine } from './execution-engine';
import type { RunResult, TriggerPacket } from './scenario-runner';

const packet = (id: string, trigger: TriggerPacket['trigger'] = 'press'): TriggerPacket => ({
  controlId: 'button',
  itemId: 'item',
  trigger,
  interactionId: id,
  sourceStateId: 'off',
  capturedAt: 0,
  steps: [],
});

const waitForAbort = (_packet: TriggerPacket, signal: AbortSignal) =>
  new Promise<RunResult>((resolve) => {
    signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
  });

describe('execution engine', () => {
  it('serializes a trigger lane while independent releases continue', async () => {
    const trace: string[] = [];
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const engine = new ExecutionEngine({
      getFingerprint: () => 'unchanged',
      onBusyChange: () => {},
      execute: async (packet) => {
        trace.push(packet.interactionId);
        if (packet.interactionId === 'first') {
          await blocked;
        }
        return { status: 'completed' };
      },
    });
    const first = engine.dispatch(packet('first'));
    const second = engine.dispatch(packet('second'));
    await engine.dispatch(packet('release', 'release'));
    expect(trace).toEqual(['first', 'release']);
    unblock();
    await Promise.all([first, second]);
    expect(trace).toEqual(['first', 'release', 'second']);
    expect(engine.busy()).toEqual({});
    engine.dispose();
  });

  it('bounds pending work and resolves every queued packet when its control stops', async () => {
    const engine = new ExecutionEngine({
      getFingerprint: () => 'unchanged',
      onBusyChange: () => {},
      execute: waitForAbort,
    });
    const running = engine.dispatch(packet('running'));
    const queued = Array.from({ length: 32 }, (_, index) => engine.dispatch(packet(String(index))));
    expect(await engine.dispatch(packet('excess'))).toEqual({ status: 'rejected' });
    await engine.stopControl('button');
    expect(
      (await Promise.all([running, ...queued])).every((result) => result.status === 'cancelled'),
    ).toBe(true);
    expect(engine.busy()).toEqual({});
    engine.dispose();
  });

  it('cancels active and queued work on disposal and rejects later dispatches', async () => {
    const executed: string[] = [];
    const engine = new ExecutionEngine({
      getFingerprint: () => 'unchanged',
      onBusyChange: () => {},
      execute: (packet, signal) => {
        executed.push(packet.interactionId);
        return waitForAbort(packet, signal);
      },
    });
    const running = engine.dispatch(packet('running'));
    const queued = engine.dispatch(packet('queued'));
    engine.dispose();
    expect(await Promise.all([running, queued])).toEqual([
      { status: 'cancelled' },
      { status: 'cancelled' },
    ]);
    expect(await engine.dispatch(packet('late'))).toEqual({ status: 'rejected' });
    expect(executed).toEqual(['running']);
    expect(engine.busy()).toEqual({});
  });
});

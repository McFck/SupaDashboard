import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ScenarioRunner,
  captureTrigger,
  type RunnerServices,
  type TriggerPacket,
} from './scenario-runner';
import type { ActionStep } from './scenario';
import type { ControlConfig } from '../controls/model';

const control = (steps: ActionStep[]): ControlConfig => ({
  id: 'button',
  name: 'Button',
  type: 'button',
  variants: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  scenario: { triggers: { press: { steps } }, events: [] },
});
const action = (id: string): ActionStep => ({ id, kind: 'action', action: { id } });
function proxyDeep<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  return new Proxy(value, {
    get(target, key, receiver) {
      return proxyDeep(Reflect.get(target, key, receiver));
    },
  });
}
const packet = (steps: ActionStep[]): TriggerPacket => ({
  controlId: 'button',
  itemId: 'tile-1',
  trigger: 'press',
  interactionId: 'interaction',
  sourceStateId: 'off',
  capturedAt: 1,
  steps,
});
const services = (trace: string[]): RunnerServices => ({
  runAction: async (ref) => {
    trace.push(ref.id);
  },
  getVariable: () => undefined,
  findVariable: () => undefined,
  setVariable: async () => false,
  getState: () => 'off',
  setState: () => {},
  emitEvent: async () => {},
});

afterEach(() => vi.useRealTimers());

describe('scenario runner', () => {
  it('captures the selected state list as an immutable snapshot', async () => {
    const steps = [action('first')];
    const config = control(steps);
    config.scenario!.triggers.press!.byState = { off: [action('override')] };
    const captured = captureTrigger(config, 'tile-1', 'press', 'r1', 'off')!;
    config.scenario!.triggers.press!.byState.off.push(action('later'));
    const trace: string[] = [];
    await new ScenarioRunner(services(trace)).run(captured);
    expect(trace).toEqual(['override']);
    expect(Object.isFrozen(captured.steps)).toBe(true);
  });

  it('captures reactive settings proxies as a plain immutable packet', () => {
    const reactive = proxyDeep(control([action('first')]));
    const captured = captureTrigger(reactive, 'tile-1', 'press', 'r1', 'off')!;
    expect(captured.steps).toEqual([action('first')]);
    expect(Object.isFrozen(captured.steps[0])).toBe(true);
  });

  it('awaits leaves in order and runs only the true nested branch', async () => {
    const trace: string[] = [];
    const runner = new ScenarioRunner({
      ...services(trace),
      findVariable: (name) => (name === 'ready' ? true : undefined),
    });
    const result = await runner.run(
      packet([
        action('before'),
        {
          id: 'if',
          kind: 'if',
          condition: { kind: 'expression', source: '{ready} && true' },
          then: [action('then')],
          else: [action('else')],
        },
        action('after'),
      ]),
    );
    expect(result.status).toBe('completed');
    expect(trace).toEqual(['before', 'then', 'after']);
  });

  it('cancels an abortable delay and clears its timer', async () => {
    vi.useFakeTimers();
    const trace: string[] = [];
    const runner = new ScenarioRunner(services(trace));
    const controller = new AbortController();
    const task = runner.run(
      packet([{ id: 'wait', kind: 'delay', ms: 30_000 }, action('later')]),
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(task).resolves.toEqual({ status: 'cancelled' });
    expect(trace).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops after a rejected action and reports only safe failure metadata', async () => {
    const trace: string[] = [];
    const runner = new ScenarioRunner({
      ...services(trace),
      runAction: async (ref) => {
        if (ref.id === 'fail') throw new Error('secret payload');
        trace.push(ref.id);
      },
    });
    const result = await runner.run(packet([action('fail'), action('later')]));
    expect(result.status).toBe('failed');
    expect(trace).toEqual([]);
    expect(result.failure).toEqual({
      controlId: 'button',
      itemId: 'tile-1',
      trigger: 'press',
      stepId: 'fail',
      kind: 'action',
      actionId: 'fail',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('fences an action that ignores abort and observes a late rejection', async () => {
    let rejectLate!: (reason?: unknown) => void;
    const operation = new Promise<void>((_, reject) => {
      rejectLate = reject;
    });
    const trace: string[] = [];
    const runner = new ScenarioRunner({
      ...services(trace),
      runAction: () => operation,
    });
    const controller = new AbortController();
    const task = runner.run(packet([action('ignored'), action('later')]), controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(task).resolves.toEqual({ status: 'cancelled' });
    rejectLate(new Error('late'));
    await Promise.resolve();
    expect(trace).toEqual([]);
  });

  it('rejects malformed predicates without running successors', async () => {
    const trace: string[] = [];
    const runner = new ScenarioRunner(services(trace));
    const result = await runner.run(
      packet([
        {
          id: 'if',
          kind: 'if',
          condition: { kind: 'expression', source: 'globalThis.alert(1)' },
          then: [],
          else: [],
        },
        action('later'),
      ]),
    );
    expect(trace).toEqual([]);
    expect(result.status).toBe('failed');
  });
});

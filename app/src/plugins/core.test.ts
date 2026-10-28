import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ScenarioRunner,
  type RunnerServices,
  type TriggerPacket,
} from '../features/automation/scenario-runner';
import { actions, install, runAction } from '../features/plugins/registry';
import type { ActionContext, ActionRef } from '../features/plugins/contracts';
import { corePlugin } from './core';

const packet = (): TriggerPacket => ({
  controlId: 'button',
  itemId: 'tile',
  trigger: 'press',
  interactionId: 'run',
  sourceStateId: 'off',
  capturedAt: 1,
  steps: [{ id: 'wrapper', kind: 'action', action: { id: 'test.sequence' } }],
});

const runner = () =>
  new ScenarioRunner({
    runAction,
    getVariable: () => undefined,
    findVariable: () => undefined,
    setVariable: async () => false,
    getState: () => 'off',
    setState: () => {},
    emitEvent: async () => {},
  } satisfies RunnerServices);

function sequence(steps: ActionRef[]) {
  actions.set('test.sequence', {
    id: 'test.sequence',
    title: 'Sequence wrapper',
    run: (_args, context) => runAction({ id: 'sequence', args: { steps } }, context),
  });
}

beforeAll(() => install(corePlugin));
afterEach(() => {
  actions.delete('test.sequence');
  actions.delete('test.nested');
  vi.useRealTimers();
});

describe('core action sequence', () => {
  it('passes the runner context to nested actions', async () => {
    let received: ActionContext | undefined;
    sequence([{ id: 'test.nested' }]);
    actions.set('test.nested', {
      id: 'test.nested',
      title: 'Nested action',
      run: (_args, context) => {
        received = context;
      },
    });

    await expect(runner().run(packet())).resolves.toEqual({ status: 'completed' });
    expect(received).toMatchObject({ controlId: 'button', itemId: 'tile', runId: 'run' });
    expect(received?.signal.aborted).toBe(false);
  });

  it('stops a running sequence before its next action after cancellation', async () => {
    vi.useFakeTimers();
    const next = vi.fn();
    sequence([{ id: 'delay', args: { ms: 30_000 } }, { id: 'test.nested' }]);
    actions.set('test.nested', { id: 'test.nested', title: 'Nested action', run: next });
    const controller = new AbortController();

    const run = runner().run(packet(), controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(run).resolves.toEqual({ status: 'cancelled' });
    expect(next).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

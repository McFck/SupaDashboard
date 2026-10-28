import type { ActionContext, ActionRef, EventAncestry } from '../plugins/contracts';
import type { ActionStep, Predicate, Trigger } from './scenario';
import { isValidDelay, MAX_SCENARIO_DEPTH, MAX_SCENARIO_NODES } from './scenario';
import { validateScenario } from './validate';
import { evaluatePredicate, type PredicateEnvironment } from './expression';
import type { VariableValue } from './variables';

export type TriggerPacket = {
  controlId: string;
  itemId: string;
  trigger: Trigger | 'event';
  listenerId?: string;
  interactionId: string;
  sourceStateId: string;
  capturedAt: number;
  steps: ActionStep[];
  event?: { id: string; parameter?: string; payload?: unknown };
  eventAncestry?: EventAncestry;
};

export type ScenarioFailure = {
  controlId: string;
  itemId: string;
  trigger: Trigger | 'event';
  stepId: string;
  kind: 'action' | 'condition' | 'delay' | 'cycle';
  actionId?: string;
};

export type RunResult = {
  status: 'completed' | 'cancelled' | 'failed' | 'rejected';
  failure?: ScenarioFailure;
};

export type RunnerServices = {
  runAction(ref: ActionRef, context: ActionContext): unknown | Promise<unknown>;
  getVariable(id: string): VariableValue | undefined;
  findVariable(name: string): VariableValue | undefined;
  setVariable(id: string, value: VariableValue, ancestry?: EventAncestry): Promise<boolean>;
  getState(controlId: string): string | undefined;
  setState(controlId: string, stateId: string): Promise<void> | void;
  emitEvent(
    id: string,
    parameter?: string,
    payload?: unknown,
    ancestry?: EventAncestry,
  ): Promise<void>;
};

class RunCancelled extends Error {}

class StepFailure extends Error {
  constructor(
    readonly stepId: string,
    readonly kind: ScenarioFailure['kind'],
    readonly actionId?: string,
  ) {
    super('Scenario step failed');
  }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new RunCancelled());
      return;
    }
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new RunCancelled());
    };
    function cleanup() {
      signal.removeEventListener('abort', abort);
    }
    function done() {
      cleanup();
      resolve();
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function nextTask(signal: AbortSignal) {
  return wait(0, signal);
}

/** Stop awaiting an ignored-signal action after cancellation while observing its eventual rejection. */
function awaitAction<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new RunCancelled());
    };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

function asSteps(value: unknown, prefix: string): ActionStep[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((action, i) => ({
    id: `${prefix}-${i + 1}`,
    kind: 'action',
    action: structuredClone(action) as ActionRef,
  }));
}

type RunState = { count: number; signal: AbortSignal; packet: TriggerPacket };

function failureOf(packet: TriggerPacket, failed: StepFailure): ScenarioFailure {
  return {
    controlId: packet.controlId,
    itemId: packet.itemId,
    trigger: packet.trigger,
    stepId: failed.stepId,
    kind: failed.kind,
    ...(failed.actionId ? { actionId: failed.actionId } : {}),
  };
}

function ensureActive(signal: AbortSignal) {
  if (signal.aborted) {
    throw new RunCancelled();
  }
}

export class ScenarioRunner {
  constructor(private services: RunnerServices) {}

  async run(
    packet: TriggerPacket,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<RunResult> {
    const snapshot = structuredClone(packet);
    const issues = validateScenario({ triggers: { press: { steps: snapshot.steps } }, events: [] });
    if (issues.length) {
      return {
        status: 'failed',
        failure: failureOf(snapshot, new StepFailure(issues[0].path, 'condition')),
      };
    }
    try {
      await this.runList(snapshot.steps, { count: 0, signal, packet: snapshot }, 0);
      return { status: 'completed' };
    } catch (error) {
      if (error instanceof RunCancelled || signal.aborted) {
        return { status: 'cancelled' };
      }
      const failed = error instanceof StepFailure ? error : new StepFailure('scenario', 'action');
      return { status: 'failed', failure: failureOf(snapshot, failed) };
    }
  }

  private async runList(steps: ActionStep[], state: RunState, depth: number): Promise<void> {
    if (depth > MAX_SCENARIO_DEPTH) {
      throw new StepFailure('scenario', 'condition');
    }
    for (const step of steps) {
      ensureActive(state.signal);
      if (++state.count > MAX_SCENARIO_NODES) {
        throw new StepFailure(step.id, 'condition');
      }
      // Yield now and then so a long list of instant steps cannot starve the page.
      if (state.count % 25 === 0) {
        await nextTask(state.signal);
        ensureActive(state.signal);
      }
      try {
        await this.runStep(step, state, depth);
        ensureActive(state.signal);
      } catch (error) {
        if (error instanceof RunCancelled || state.signal.aborted) {
          throw new RunCancelled();
        }
        if (error instanceof StepFailure) {
          throw error;
        }
        if (step.kind === 'action') {
          throw new StepFailure(step.id, 'action', step.action.id);
        }
        throw new StepFailure(step.id, step.kind === 'if' ? 'condition' : 'delay');
      }
    }
  }

  private async runStep(step: ActionStep, state: RunState, depth: number) {
    if (step.kind === 'delay') {
      if (!isValidDelay(step.ms)) {
        throw new StepFailure(step.id, 'delay');
      }
      await wait(step.ms, state.signal);
      return;
    }
    if (step.kind === 'if') {
      const env: PredicateEnvironment = {
        getVariable: (id) => this.services.getVariable(id),
        findVariable: (name) => this.services.findVariable(name),
        getState: (id) => this.services.getState(id === 'self' ? state.packet.controlId : id),
      };
      const branch = evaluatePredicate(step.condition as Predicate, env) ? step.then : step.else;
      await this.runList(branch, state, depth + 1);
      return;
    }
    // Legacy built-in delay and sequence actions run inline, like their canonical steps.
    if (step.action.id === 'delay') {
      const ms = step.action.args?.ms;
      if (!isValidDelay(ms)) {
        throw new StepFailure(step.id, 'delay');
      }
      await wait(ms, state.signal);
    } else if (step.action.id === 'sequence') {
      const nested = asSteps(step.action.args?.steps, step.id);
      if (!nested) {
        throw new StepFailure(step.id, 'action');
      }
      await this.runList(nested, state, depth + 1);
    } else {
      const operation = Promise.resolve(this.services.runAction(step.action, this.context(state)));
      await awaitAction(operation, state.signal);
    }
  }

  private context(state: RunState): ActionContext {
    const packet = state.packet;
    const active = () => ensureActive(state.signal);
    return {
      signal: state.signal,
      runId: packet.interactionId,
      controlId: packet.controlId,
      itemId: packet.itemId,
      trigger: packet.trigger,
      listenerId: packet.listenerId,
      sourceStateId: packet.sourceStateId,
      event: packet.event,
      eventAncestry: packet.eventAncestry,
      getVariable: (id) => this.services.getVariable(id),
      setVariable: async (id, value) => {
        active();
        const result = await this.services.setVariable(id, value, packet.eventAncestry);
        active();
        return result;
      },
      getVariant: (id) => this.services.getState(id === 'self' ? packet.controlId : id),
      setVariant: async (id, variant) => {
        active();
        await this.services.setState(id === 'self' ? packet.controlId : id, variant);
        active();
      },
      emitEvent: async (id, parameter, payload) => {
        active();
        await this.services.emitEvent(id, parameter, payload, packet.eventAncestry);
        active();
      },
      runSteps: async (steps) => {
        active();
        await this.runList(steps, state, 0);
        active();
      },
    };
  }
}

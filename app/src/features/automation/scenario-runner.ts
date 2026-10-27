import type { ActionContext, ActionRef, EventAncestry } from '../plugins/contracts';
import type { ControlConfig } from '../controls/model';
import type { ActionStep, EventList, Predicate, Trigger, TriggerList } from './scenario';
import { MAX_DELAY_MS, MAX_SCENARIO_DEPTH, MAX_SCENARIO_NODES, validateScenario } from './scenario';
import { evaluatePredicate, type PredicateEnvironment } from './templates';
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
  kind: 'action' | 'condition' | 'delay';
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
  onError(failure: ScenarioFailure): void;
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

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

function cloneSerializable<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneSerializable(item)) as T;
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>))
      copy[key] = cloneSerializable(child);
    return copy as T;
  }
  return value;
}

function packet(
  control: ControlConfig,
  itemId: string,
  trigger: Trigger | 'event',
  listenerId: string | undefined,
  interactionId: string,
  sourceStateId: string,
  capturedAt: number,
  list: TriggerList,
  event?: TriggerPacket['event'],
): TriggerPacket | undefined {
  const own = list.byState && Object.hasOwn(list.byState, sourceStateId);
  const steps = own ? list.byState![sourceStateId] : list.steps;
  return freezeDeep({
    controlId: control.id,
    itemId,
    trigger,
    ...(listenerId ? { listenerId } : {}),
    interactionId,
    sourceStateId,
    capturedAt,
    steps: cloneSerializable(steps),
    ...(event ? { event: cloneSerializable(event) } : {}),
  });
}

export function captureTrigger(
  control: ControlConfig,
  itemId: string,
  trigger: Trigger,
  interactionId: string,
  sourceStateId: string,
  capturedAt = Date.now(),
): TriggerPacket | undefined {
  const list = control.scenario?.triggers[trigger];
  return list
    ? packet(control, itemId, trigger, undefined, interactionId, sourceStateId, capturedAt, list)
    : undefined;
}

export function captureEvent(
  control: ControlConfig,
  itemId: string,
  listener: EventList,
  interactionId: string,
  sourceStateId: string,
  capturedAt: number,
  parameter?: string,
  payload?: unknown,
  eventAncestry?: EventAncestry,
): TriggerPacket {
  return {
    ...packet(
      control,
      itemId,
      'event',
      listener.id,
      interactionId,
      sourceStateId,
      capturedAt,
      listener.list,
      { id: listener.eventId, parameter, payload },
    )!,
    ...(eventAncestry ? { eventAncestry: structuredClone(eventAncestry) } : {}),
  };
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

export class ScenarioRunner {
  constructor(private services: RunnerServices) {}

  async run(
    packet: TriggerPacket,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<RunResult> {
    const snapshot = structuredClone(packet);
    const issues = validateScenario({ triggers: { press: { steps: snapshot.steps } }, events: [] });
    if (issues.length) {
      const failure = {
        controlId: snapshot.controlId,
        itemId: snapshot.itemId,
        trigger: snapshot.trigger,
        stepId: issues[0].path,
        kind: 'condition' as const,
      };
      this.report(failure);
      return { status: 'failed', failure };
    }
    const state: { count: number; signal: AbortSignal; packet: TriggerPacket } = {
      count: 0,
      signal,
      packet: snapshot,
    };
    try {
      await this.runList(snapshot.steps, state, 0);
      return { status: 'completed' };
    } catch (error) {
      if (error instanceof RunCancelled || signal.aborted) return { status: 'cancelled' };
      const failed = error instanceof StepFailure ? error : new StepFailure('scenario', 'action');
      const failure: ScenarioFailure = {
        controlId: snapshot.controlId,
        itemId: snapshot.itemId,
        trigger: snapshot.trigger,
        stepId: failed.stepId,
        kind: failed.kind,
        ...(failed.actionId ? { actionId: failed.actionId } : {}),
      };
      this.report(failure);
      return { status: 'failed', failure };
    }
  }

  private async runList(
    steps: ActionStep[],
    state: { count: number; signal: AbortSignal; packet: TriggerPacket },
    depth: number,
  ): Promise<void> {
    if (depth > MAX_SCENARIO_DEPTH) throw new StepFailure('scenario', 'condition');
    for (const step of steps) {
      this.ensureActive(state.signal);
      if (++state.count > MAX_SCENARIO_NODES) throw new StepFailure(step.id, 'condition');
      if (state.count % 25 === 0) {
        await nextTask(state.signal);
        this.ensureActive(state.signal);
      }
      try {
        if (step.kind === 'delay') {
          if (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > MAX_DELAY_MS)
            throw new StepFailure(step.id, 'delay');
          await wait(step.ms, state.signal);
        } else if (step.kind === 'if') {
          const env: PredicateEnvironment = {
            getVariable: (id) => this.services.getVariable(id),
            findVariable: (name) => this.services.findVariable(name),
            getState: (id) => this.services.getState(id === 'self' ? state.packet.controlId : id),
          };
          const branch = evaluatePredicate(step.condition as Predicate, env)
            ? step.then
            : step.else;
          await this.runList(branch, state, depth + 1);
        } else if (step.kind === 'action') {
          if (step.action.id === 'delay') {
            const ms = step.action.args?.ms;
            if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > MAX_DELAY_MS)
              throw new StepFailure(step.id, 'delay');
            await wait(ms, state.signal);
          } else if (step.action.id === 'sequence') {
            const nested = asSteps(step.action.args?.steps, step.id);
            if (!nested) throw new StepFailure(step.id, 'action');
            await this.runList(nested, state, depth + 1);
          } else {
            const context = this.context(state);
            let operation: Promise<unknown>;
            try {
              operation = Promise.resolve(this.services.runAction(step.action, context));
            } catch (error) {
              throw error;
            }
            await awaitAction(operation, state.signal);
          }
        }
        this.ensureActive(state.signal);
      } catch (error) {
        if (error instanceof RunCancelled || state.signal.aborted) throw new RunCancelled();
        if (error instanceof StepFailure) throw error;
        throw new StepFailure(
          step.id,
          step.kind === 'if' ? 'condition' : step.kind === 'delay' ? 'delay' : 'action',
          step.kind === 'action' ? step.action.id : undefined,
        );
      }
    }
  }

  private context(state: {
    count: number;
    signal: AbortSignal;
    packet: TriggerPacket;
  }): ActionContext {
    const packet = state.packet;
    const active = () => this.ensureActive(state.signal);
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

  private ensureActive(signal: AbortSignal) {
    if (signal.aborted) throw new RunCancelled();
  }
  private report(failure: ScenarioFailure) {
    try {
      this.services.onError(failure);
    } catch {
      /* error reporting must not restart a failed run */
    }
  }
}

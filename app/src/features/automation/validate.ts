import { compileExpression } from './expression-parser';
import { isRecord } from './plain-data';
import { validAppVariable } from '../apps/keys';
import { isEffectId } from '../effects/catalogue';
import {
  actionRef,
  isValidDelay,
  MAX_SCENARIO_DEPTH,
  MAX_SCENARIO_NODES,
  type ScenarioIssue,
} from './scenario';

const DELAY_MESSAGE = 'Wait duration must be an integer from 0 to 86400000';
const OPERATORS: readonly unknown[] = ['eq', 'ne', 'gt', 'lt'];

/** Reports every problem in a stored scenario without changing it, in tree order. */
export function validateScenario(value: unknown): ScenarioIssue[] {
  const walk = new ScenarioWalk();
  const scenario = isRecord(value) ? value : {};
  if (isRecord(scenario.triggers)) {
    for (const [trigger, list] of Object.entries(scenario.triggers)) {
      walk.list(list, `triggers.${trigger}`);
    }
  }
  if (Array.isArray(scenario.events)) {
    scenario.events.forEach((event, i) => {
      if (isRecord(event)) {
        walk.list(event.list, `events.${i}`);
      }
    });
  }
  return walk.issues;
}

function validOperand(operand: unknown) {
  if (!isRecord(operand)) {
    return false;
  }
  if (operand.kind === 'literal') {
    const value = operand.value;
    return (
      typeof value === 'boolean' ||
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      value === null
    );
  }
  if (operand.kind === 'variable') {
    return typeof operand.id === 'string' && !!operand.id && validAppVariable(operand.id);
  }
  return operand.kind === 'state' && typeof operand.controlId === 'string' && !!operand.controlId;
}

function conditionIssue(condition: unknown): string | undefined {
  if (!isRecord(condition)) {
    return 'Condition is invalid';
  }
  if (condition.kind === 'expression') {
    if (typeof condition.source !== 'string') {
      return 'Expression is invalid';
    }
    try {
      compileExpression(condition.source);
    } catch (error) {
      return error instanceof Error ? error.message : 'Expression is invalid';
    }
    return undefined;
  }
  if (condition.kind !== 'compare') {
    return 'Condition is invalid';
  }
  const { op, left, right } = condition;
  if (!OPERATORS.includes(op) || !validOperand(left) || !validOperand(right)) {
    return 'Condition is invalid';
  }
  if ((left.kind === 'state' || right.kind === 'state') && op !== 'eq' && op !== 'ne') {
    return 'State values support equality only';
  }
  return undefined;
}

class ScenarioWalk {
  readonly issues: ScenarioIssue[] = [];
  private readonly ids = new Set<string>();
  private count = 0;

  list(list: unknown, path: string) {
    if (!isRecord(list)) {
      return;
    }
    if (list.effect !== undefined && !isEffectId(list.effect)) {
      this.add(path, 'Effect is unavailable');
    }
    this.steps(list.steps, `${path}.steps`, 1);
    if (isRecord(list.byState)) {
      for (const [stateId, steps] of Object.entries(list.byState)) {
        this.steps(steps, `${path}.byState.${stateId}`, 1);
      }
    }
  }

  private steps(steps: unknown, path: string, depth: number) {
    if (!Array.isArray(steps)) {
      this.add(path, 'Expected a step list');
      return;
    }
    steps.forEach((step, i) => this.step(step, `${path}.${i}`, depth));
  }

  private step(step: unknown, path: string, depth: number) {
    this.countNode(path, depth);
    if (!isRecord(step) || typeof step.id !== 'string' || !step.id) {
      this.add(path, 'Step ID is missing');
      return;
    }
    if (this.ids.has(step.id)) {
      this.add(path, 'Step IDs must be unique');
    }
    this.ids.add(step.id);
    if (step.effect !== undefined && !isEffectId(step.effect)) {
      this.add(path, 'Effect is unavailable');
    }
    if (step.kind === 'action') {
      if (!actionRef(step.action)) {
        this.add(path, 'Action reference is invalid');
      }
    } else if (step.kind === 'delay') {
      if (!isValidDelay(step.ms)) {
        this.add(path, DELAY_MESSAGE);
      }
    } else if (step.kind === 'if') {
      const issue = conditionIssue(step.condition);
      if (issue) {
        this.add(path, issue);
      }
      this.steps(step.then, `${path}.then`, depth + 1);
      this.steps(step.else, `${path}.else`, depth + 1);
    } else {
      this.add(path, 'Step type is unavailable');
    }
  }

  /** Counts one node against the scenario limits; returns whether it is nested too deep. */
  private countNode(path: string, depth: number) {
    this.count++;
    if (this.count > MAX_SCENARIO_NODES) {
      this.add(path, 'Scenario exceeds 1000 steps');
    }
    const tooDeep = depth > MAX_SCENARIO_DEPTH;
    if (tooDeep) {
      this.add(path, 'Scenario exceeds 16 levels');
    }
    return tooDeep;
  }

  private add(path: string, message: string) {
    this.issues.push({ path, message });
  }
}

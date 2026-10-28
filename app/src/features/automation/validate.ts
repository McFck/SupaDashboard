import { compileExpression } from './expression';
import { isRecord } from './plain-data';
import {
  actionRef,
  isValidDelay,
  MAX_SCENARIO_DEPTH,
  MAX_SCENARIO_NODES,
  type ScenarioIssue,
} from './scenario';

export function validateScenario(value: unknown): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  const ids = new Set<string>();
  let count = 0;
  const inspectLegacy = (steps: unknown[], path: string, depth: number) => {
    for (let i = 0; i < steps.length; i++) {
      const legacy = steps[i];
      const stepPath = `${path}.${i}`;
      count++;
      if (count > MAX_SCENARIO_NODES)
        issues.push({ path: stepPath, message: 'Scenario exceeds 1000 steps' });
      if (depth > MAX_SCENARIO_DEPTH) {
        issues.push({ path: stepPath, message: 'Scenario exceeds 16 levels' });
        continue;
      }
      if (!actionRef(legacy)) continue;
      if (legacy.id === 'sequence') {
        if (Array.isArray(legacy.args?.steps))
          inspectLegacy(legacy.args.steps, stepPath, depth + 1);
        else issues.push({ path: stepPath, message: 'Action sequence is invalid' });
      } else if (legacy.id === 'delay') {
        if (!isValidDelay(legacy.args?.ms))
          issues.push({
            path: stepPath,
            message: 'Wait duration must be an integer from 0 to 86400000',
          });
      }
    }
  };
  const visit = (steps: unknown, path: string, depth: number) => {
    if (!Array.isArray(steps)) {
      issues.push({ path, message: 'Expected a step list' });
      return;
    }
    for (let i = 0; i < steps.length; i++) {
      const stepPath = `${path}.${i}`;
      const step = steps[i];
      count++;
      if (count > MAX_SCENARIO_NODES)
        issues.push({ path: stepPath, message: 'Scenario exceeds 1000 steps' });
      if (depth > MAX_SCENARIO_DEPTH)
        issues.push({ path: stepPath, message: 'Scenario exceeds 16 levels' });
      if (!isRecord(step) || typeof step.id !== 'string' || !step.id) {
        issues.push({ path: stepPath, message: 'Step ID is missing' });
        continue;
      }
      if (ids.has(step.id)) issues.push({ path: stepPath, message: 'Step IDs must be unique' });
      ids.add(step.id);
      if (step.kind === 'action') {
        if (!actionRef(step.action))
          issues.push({ path: stepPath, message: 'Action reference is invalid' });
        else if (step.action.id === 'delay') {
          if (!isValidDelay(step.action.args?.ms))
            issues.push({
              path: stepPath,
              message: 'Wait duration must be an integer from 0 to 86400000',
            });
        } else if (step.action.id === 'sequence') {
          if (!Array.isArray(step.action.args?.steps))
            issues.push({ path: stepPath, message: 'Action sequence is invalid' });
          else inspectLegacy(step.action.args.steps, stepPath, depth + 1);
        }
      } else if (step.kind === 'delay') {
        if (!isValidDelay(step.ms))
          issues.push({
            path: stepPath,
            message: 'Wait duration must be an integer from 0 to 86400000',
          });
      } else if (step.kind === 'if') {
        if (!isRecord(step.condition))
          issues.push({ path: stepPath, message: 'Condition is invalid' });
        else if (step.condition.kind === 'expression') {
          if (typeof step.condition.source !== 'string')
            issues.push({ path: stepPath, message: 'Expression is invalid' });
          else
            try {
              compileExpression(step.condition.source);
            } catch (error) {
              issues.push({
                path: stepPath,
                message: error instanceof Error ? error.message : 'Expression is invalid',
              });
            }
        } else if (step.condition.kind === 'compare') {
          const validOperand = (operand: unknown) =>
            isRecord(operand) &&
            ((operand.kind === 'literal' &&
              (typeof operand.value === 'boolean' ||
                typeof operand.value === 'string' ||
                (typeof operand.value === 'number' && Number.isFinite(operand.value)) ||
                operand.value === null)) ||
              (operand.kind === 'variable' && typeof operand.id === 'string' && !!operand.id) ||
              (operand.kind === 'state' &&
                typeof operand.controlId === 'string' &&
                !!operand.controlId));
          if (
            !['eq', 'ne', 'gt', 'lt'].includes(step.condition.op) ||
            !validOperand(step.condition.left) ||
            !validOperand(step.condition.right)
          )
            issues.push({ path: stepPath, message: 'Condition is invalid' });
          else if (
            (step.condition.left.kind === 'state' || step.condition.right.kind === 'state') &&
            step.condition.op !== 'eq' &&
            step.condition.op !== 'ne'
          )
            issues.push({ path: stepPath, message: 'State values support equality only' });
        } else issues.push({ path: stepPath, message: 'Condition is invalid' });
        visit(step.then, `${stepPath}.then`, depth + 1);
        visit(step.else, `${stepPath}.else`, depth + 1);
      } else issues.push({ path: stepPath, message: 'Step type is unavailable' });
    }
  };
  const walkList = (list: unknown, path: string) => {
    if (!isRecord(list)) return;
    visit(list.steps, `${path}.steps`, 1);
    if (isRecord(list.byState))
      for (const [stateId, steps] of Object.entries(list.byState))
        visit(steps, `${path}.byState.${stateId}`, 1);
  };
  const scenario = isRecord(value) ? value : {};
  if (isRecord(scenario.triggers))
    for (const [trigger, list] of Object.entries(scenario.triggers))
      walkList(list, `triggers.${trigger}`);
  if (Array.isArray(scenario.events))
    scenario.events.forEach((event, i) => {
      if (isRecord(event)) walkList(event.list, `events.${i}`);
    });
  return issues;
}

import { compileExpression, ExpressionError, type Expr } from './expression-parser';
import type { Operand, Predicate } from './scenario';
import type { VariableValue } from './variables';

export type PredicateEnvironment = {
  getVariable(id: string): VariableValue | undefined;
  findVariable(name: string): VariableValue | undefined;
  getState(controlId: string): string | undefined;
};

function boolean(value: VariableValue, at: string): boolean {
  if (typeof value !== 'boolean') throw new ExpressionError(`${at} requires a Boolean value`);
  return value;
}

function compare(op: '==' | '!=' | '>' | '<', left: VariableValue, right: VariableValue) {
  if (op === '==' || op === '!=') {
    if (typeof left !== typeof right)
      throw new ExpressionError('Compared values must have the same type');
    return op === '==' ? left === right : left !== right;
  }
  if (typeof left !== 'number' || typeof right !== 'number')
    throw new ExpressionError('Ordering requires numeric values');
  return op === '>' ? left > right : left < right;
}

function evaluate(node: Expr, valueOf: (name: string) => VariableValue | undefined): VariableValue {
  if (node.kind === 'literal') return node.value;
  if (node.kind === 'variable') {
    const value = valueOf(node.name);
    if (value === undefined) throw new ExpressionError(`Unknown variable {${node.name}}`);
    return value;
  }
  if (node.kind === 'not') return !boolean(evaluate(node.value, valueOf), '!');
  const left = evaluate(node.left, valueOf);
  if (node.op === '&&') return boolean(left, '&&') && boolean(evaluate(node.right, valueOf), '&&');
  if (node.op === '||') return boolean(left, '||') || boolean(evaluate(node.right, valueOf), '||');
  return compare(node.op, left, evaluate(node.right, valueOf));
}

export function evaluateExpression(
  source: string,
  valueOf: (name: string) => VariableValue | undefined,
) {
  const value = evaluate(compileExpression(source), valueOf);
  if (typeof value !== 'boolean') throw new ExpressionError('Expression must return a Boolean');
  return value;
}

function operand(value: Operand, env: PredicateEnvironment): VariableValue {
  if (value.kind === 'literal') return value.value;
  if (value.kind === 'variable') {
    const resolved = env.getVariable(value.id);
    if (resolved === undefined) throw new ExpressionError(`Unavailable variable ${value.id}`);
    return resolved;
  }
  const state = env.getState(value.controlId);
  if (state === undefined) throw new ExpressionError(`Unavailable state ${value.controlId}`);
  return state;
}

export function evaluatePredicate(predicate: Predicate, env: PredicateEnvironment) {
  if (predicate.kind === 'expression')
    return evaluateExpression(predicate.source, env.findVariable);
  const left = operand(predicate.left, env),
    right = operand(predicate.right, env);
  if (
    (predicate.left.kind === 'state' || predicate.right.kind === 'state') &&
    predicate.op !== 'eq' &&
    predicate.op !== 'ne'
  )
    throw new ExpressionError('State values support equality only');
  return compare(
    predicate.op === 'eq' ? '==' : predicate.op === 'ne' ? '!=' : predicate.op === 'gt' ? '>' : '<',
    left,
    right,
  );
}

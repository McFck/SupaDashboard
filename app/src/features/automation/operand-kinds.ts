// What a condition operand is, and which comparisons make sense between two of them.
import { parseAppVariable } from '../apps/keys';
import type { Operand, Predicate } from './scenario';
import type { VariableType } from './variables';

export type OperandKind = 'literal' | 'variable' | 'app' | 'state';
export type VariableTypeOf = (id: string) => VariableType | undefined;

/** An App operand is a variable named `app.<app>.<state>`, or one still waiting for its app. */
export function operandKind(operand: Operand, appPending: boolean): OperandKind {
  if (operand.kind !== 'variable') {
    return operand.kind;
  }
  return appPending || parseAppVariable(operand.id) ? 'app' : 'variable';
}

/** Only numbers can be ordered: number literals and integer or float variables. */
export function isNumeric(operand: Operand, typeOf: VariableTypeOf): boolean {
  if (operand.kind === 'literal') {
    return typeof operand.value === 'number';
  }
  if (operand.kind === 'state') {
    return false;
  }
  const type = typeOf(operand.id);
  return !parseAppVariable(operand.id) && (type === 'integer' || type === 'float');
}

export function comparators(
  left: Operand,
  right: Operand,
  typeOf: VariableTypeOf,
): Extract<Predicate, { kind: 'compare' }>['op'][] {
  return isNumeric(left, typeOf) && isNumeric(right, typeOf)
    ? ['eq', 'ne', 'gt', 'lt']
    : ['eq', 'ne'];
}

/** The right side an empty text value becomes once the left side is a number, so ordering is offered. */
export function alignRight(left: Operand, right: Operand, typeOf: VariableTypeOf): Operand {
  return isNumeric(left, typeOf) && right.kind === 'literal' && right.value === ''
    ? { kind: 'literal', value: 0 }
    : right;
}

/** The first variable an ordinary Variable operand may start with; app variables belong to App. */
export function firstPlainVariable(ids: readonly string[]): string {
  return ids.find((id) => !parseAppVariable(id)) ?? '';
}

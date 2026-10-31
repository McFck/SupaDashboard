import { describe, expect, it } from 'vitest';
import { alignRight, comparators, firstPlainVariable, operandKind } from './operand-kinds';
import type { Operand } from './scenario';
import type { VariableType } from './variables';

const types: Record<string, VariableType> = {
  count: 'integer',
  level: 'float',
  muted: 'boolean',
  title: 'string',
  'app.chat.running': 'boolean',
};
const typeOf = (id: string) => types[id];
const variable = (id: string): Operand => ({ kind: 'variable', id });
const literal = (value: boolean | number | string): Operand => ({ kind: 'literal', value });

describe('condition operands', () => {
  it('keeps a Variable operand a Variable, whatever it names or is empty', () => {
    expect(operandKind(variable(''), false)).toBe('variable');
    expect(operandKind(variable('count'), false)).toBe('variable');
    expect(operandKind(variable('app.chat.running'), false)).toBe('app');
    expect(operandKind(variable(''), true)).toBe('app');
  });

  it('never starts a Variable operand on an app variable', () => {
    expect(firstPlainVariable(['app.chat.running', 'count'])).toBe('count');
    expect(firstPlainVariable(['app.chat.running'])).toBe('');
  });

  it.each([
    ['numbers', variable('count'), literal(3), true],
    ['two number variables', variable('level'), variable('count'), true],
    ['two number literals', literal(1), literal(2), true],
    ['a boolean', variable('muted'), literal(true), false],
    ['text', variable('title'), literal('x'), false],
    ['a number against text', variable('count'), literal(''), false],
    ['an app operand', variable('app.chat.running'), literal(true), false],
    ['a control state', { kind: 'state', controlId: 'self' } as Operand, literal(1), false],
  ])('offers > and < only for numbers: %s', (_, left, right, ordered) => {
    expect(comparators(left, right, typeOf)).toEqual(
      ordered ? ['eq', 'ne', 'gt', 'lt'] : ['eq', 'ne'],
    );
  });

  it('turns an empty text right side into a number once the left side is numeric', () => {
    expect(alignRight(variable('count'), literal(''), typeOf)).toEqual(literal(0));
    expect(alignRight(variable('title'), literal(''), typeOf)).toEqual(literal(''));
    expect(alignRight(variable('count'), literal('x'), typeOf)).toEqual(literal('x'));
  });
});

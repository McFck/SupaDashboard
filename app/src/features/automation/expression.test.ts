import { describe, expect, it } from 'vitest';
import { evaluateExpression, evaluatePredicate } from './expression';
import { ExpressionError } from './expression-parser';

describe('safe conditions', () => {
  it('parses precedence, typed comparisons, parentheses and short-circuits', () => {
    const values: Record<string, boolean | number | string> = {
      recording: true,
      count: 2,
      title: 'a',
    };
    const get = (name: string) => values[name];
    expect(evaluateExpression('{recording} && {count} > 0 || false', get)).toBe(true);
    expect(evaluateExpression('!({recording} && {count} == 0)', get)).toBe(true);
    expect(evaluateExpression('false && {missing}', get)).toBe(false);
    expect(evaluateExpression('true || {missing}', get)).toBe(true);
    expect(evaluateExpression('{title} == "a"', get)).toBe(true);
    expect(evaluateExpression('"Мир" != "мир"', get)).toBe(true);
  });

  it('rejects unresolved values, type mismatches and expressions that do not return Boolean', () => {
    const get = (name: string) => (name === 'count' ? 2 : undefined);
    expect(() => evaluateExpression('{missing}', get)).toThrow('Unknown variable');
    expect(() => evaluateExpression('{count} && true', get)).toThrow('Boolean');
    expect(() => evaluateExpression('{count} == "2"', get)).toThrow('same type');
    expect(() => evaluateExpression('"2" > 1', get)).toThrow('numeric');
    expect(() => evaluateExpression('2', get)).toThrow('must return a Boolean');
  });

  it('rejects JavaScript, property access, assignment and calls without evaluating them', () => {
    for (const source of [
      'globalThis',
      '({}).constructor',
      '{count}.toString()',
      '{count} = 2',
      'alert(1)',
      'new Function("return 1")',
    ])
      expect(() => evaluateExpression(source, () => undefined)).toThrow(ExpressionError);
  });

  it('bounds source and parse depth', () => {
    expect(() => evaluateExpression('x'.repeat(4097), () => undefined)).toThrow('too long');
    const nested = '('.repeat(33) + 'true' + ')'.repeat(33);
    expect(() => evaluateExpression(nested, () => undefined)).toThrow('deeply nested');
  });

  it('evaluates ID operands and stable current-state IDs with strict operator rules', () => {
    const env = {
      getVariable: (id: string) => (id === 'v-count' ? 2 : undefined),
      findVariable: (name: string) => (name === 'count' ? 2 : undefined),
      getState: (id: string) => (id === 'self' ? 'state-on' : undefined),
    };
    expect(
      evaluatePredicate(
        {
          kind: 'compare',
          left: { kind: 'variable', id: 'v-count' },
          op: 'gt',
          right: { kind: 'literal', value: 1 },
        },
        env,
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        {
          kind: 'compare',
          left: { kind: 'state', controlId: 'self' },
          op: 'eq',
          right: { kind: 'literal', value: 'state-on' },
        },
        env,
      ),
    ).toBe(true);
    expect(evaluatePredicate({ kind: 'expression', source: '{count} > 1' }, env)).toBe(true);
    expect(() =>
      evaluatePredicate(
        {
          kind: 'compare',
          left: { kind: 'state', controlId: 'self' },
          op: 'gt',
          right: { kind: 'literal', value: 'state-on' },
        },
        env,
      ),
    ).toThrow('equality only');
    expect(() =>
      evaluatePredicate(
        {
          kind: 'compare',
          left: { kind: 'variable', id: 'missing' },
          op: 'eq',
          right: { kind: 'literal', value: false },
        },
        env,
      ),
    ).toThrow('Unavailable variable');
  });
});

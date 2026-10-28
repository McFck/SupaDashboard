import { describe, expect, it } from 'vitest';
import { evaluatePredicate, type PredicateEnvironment } from './expression';
import { ExpressionError } from './expression-parser';

const expression = (source: string, findVariable: PredicateEnvironment['findVariable']) =>
  evaluatePredicate(
    { kind: 'expression', source },
    { findVariable, getVariable: () => undefined, getState: () => undefined },
  );

describe('safe conditions', () => {
  it('parses precedence, typed comparisons, parentheses and short-circuits', () => {
    const values: Record<string, boolean | number | string> = {
      recording: true,
      count: 2,
      title: 'a',
    };
    const get = (name: string) => values[name];
    expect(expression('{recording} && {count} > 0 || false', get)).toBe(true);
    expect(expression('!({recording} && {count} == 0)', get)).toBe(true);
    expect(expression('false && {missing}', get)).toBe(false);
    expect(expression('true || {missing}', get)).toBe(true);
    expect(expression('{title} == "a"', get)).toBe(true);
    expect(expression('"Мир" != "мир"', get)).toBe(true);
  });

  it('rejects unresolved values, type mismatches and expressions that do not return Boolean', () => {
    const get = (name: string) => (name === 'count' ? 2 : undefined);
    expect(() => expression('{missing}', get)).toThrow('Unknown variable');
    expect(() => expression('{count} && true', get)).toThrow('Boolean');
    expect(() => expression('{count} == "2"', get)).toThrow('same type');
    expect(() => expression('"2" > 1', get)).toThrow('numeric');
    expect(() => expression('2', get)).toThrow('must return a Boolean');
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
      expect(() => expression(source, () => undefined)).toThrow(ExpressionError);
  });

  it('bounds source and parse depth', () => {
    expect(() => expression('x'.repeat(4097), () => undefined)).toThrow('too long');
    const nested = '('.repeat(33) + 'true' + ')'.repeat(33);
    expect(() => expression(nested, () => undefined)).toThrow('deeply nested');
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

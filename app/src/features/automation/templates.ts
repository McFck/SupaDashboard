import type { Operand, Predicate, Scalar } from './scenario';
import type { VariableValue } from './variables';

export const MAX_EXPRESSION_SOURCE = 4096;
export const MAX_EXPRESSION_DEPTH = 32;
type Expr =
  | { kind: 'literal'; value: Scalar }
  | { kind: 'variable'; name: string }
  | { kind: 'not'; value: Expr }
  | { kind: 'binary'; op: '&&' | '||' | '==' | '!=' | '>' | '<'; left: Expr; right: Expr };
type Token = { kind: 'literal' | 'variable' | 'operator' | 'eof'; value?: Scalar | string; at: number };
export type TemplateResult = { text: string; unknown: string[] };
export type PredicateEnvironment = {
  getVariable(id: string): VariableValue | undefined;
  findVariable(name: string): VariableValue | undefined;
  getState(controlId: string): string | undefined;
};

export class ExpressionError extends Error {
  constructor(message: string) { super(message); this.name = 'ExpressionError'; }
}

export function renderTemplate(source: string, valueOf: (name: string) => VariableValue | undefined): TemplateResult {
  let text = '';
  const unknown = new Set<string>();
  for (let i = 0; i < source.length;) {
    if (source.startsWith('{{', i)) { text += '{'; i += 2; continue; }
    if (source.startsWith('}}', i)) { text += '}'; i += 2; continue; }
    if (source[i] !== '{') { text += source[i++]; continue; }
    const close = source.indexOf('}', i + 1);
    if (close < 0) { text += source.slice(i); break; }
    const name = source.slice(i + 1, close).trim();
    if (!name) { text += source.slice(i, close + 1); i = close + 1; continue; }
    const value = valueOf(name);
    if (value === undefined) { text += source.slice(i, close + 1); unknown.add(name); }
    else text += String(value);
    i = close + 1;
  }
  return { text, unknown: [...unknown] };
}

function tokenize(source: string): Token[] {
  if (source.length > MAX_EXPRESSION_SOURCE) throw new ExpressionError('Expression is too long');
  const tokens: Token[] = [];
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i])) { i++; continue; }
    const at = i;
    if (source[i] === '(' || source[i] === ')') { tokens.push({ kind: 'operator', value: source[i++], at }); continue; }
    const pair = source.slice(i, i + 2);
    if (['&&', '||', '==', '!='].includes(pair)) { tokens.push({ kind: 'operator', value: pair, at }); i += 2; continue; }
    if (['!', '>', '<'].includes(source[i])) { tokens.push({ kind: 'operator', value: source[i++], at }); continue; }
    if (source[i] === '{') {
      const end = source.indexOf('}', i + 1);
      if (end < 0) throw new ExpressionError(`Unclosed variable at ${at}`);
      const name = source.slice(i + 1, end).trim();
      if (!name) throw new ExpressionError(`Empty variable at ${at}`);
      tokens.push({ kind: 'variable', value: name, at });
      i = end + 1;
      continue;
    }
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i++];
      let value = '', closed = false;
      while (i < source.length) {
        const ch = source[i++];
        if (ch === quote) { closed = true; break; }
        if (ch !== '\\') { value += ch; continue; }
        if (i >= source.length) break;
        const escaped = source[i++];
        const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" };
        if (!(escaped in escapes)) throw new ExpressionError(`Invalid string escape at ${i - 2}`);
        value += escapes[escaped];
      }
      if (!closed) throw new ExpressionError(`Unclosed string at ${at}`);
      tokens.push({ kind: 'literal', value, at });
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(source.slice(i));
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new ExpressionError(`Number must be finite at ${at}`);
      tokens.push({ kind: 'literal', value, at });
      i += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
    if (word && (word[0] === 'true' || word[0] === 'false')) {
      tokens.push({ kind: 'literal', value: word[0] === 'true', at });
      i += word[0].length;
      continue;
    }
    throw new ExpressionError(`Unexpected token at ${at}`);
  }
  tokens.push({ kind: 'eof', at: source.length });
  return tokens;
}

class Parser {
  private index = 0;
  private nesting = 0;
  constructor(private tokens: Token[]) {}
  private get token() { return this.tokens[this.index]; }
  private take(value: string) {
    if (this.token.value !== value) return false;
    this.index++;
    return true;
  }
  parse(): Expr {
    const expression = this.or();
    if (this.token.kind !== 'eof') throw new ExpressionError(`Unexpected token at ${this.token.at}`);
    if (this.depth(expression) > MAX_EXPRESSION_DEPTH) throw new ExpressionError('Expression is too deeply nested');
    return expression;
  }
  private or(): Expr {
    let left = this.and();
    while (this.take('||')) left = { kind: 'binary', op: '||', left, right: this.and() };
    return left;
  }
  private and(): Expr {
    let left = this.compare();
    while (this.take('&&')) left = { kind: 'binary', op: '&&', left, right: this.compare() };
    return left;
  }
  private compare(): Expr {
    const left = this.unary();
    if (this.token.value === '==' || this.token.value === '!=' || this.token.value === '>' || this.token.value === '<') {
      const op = this.token.value as '==' | '!=' | '>' | '<';
      this.index++;
      return { kind: 'binary', op, left, right: this.unary() };
    }
    return left;
  }
  private unary(): Expr {
    if (this.token.value === '!') return this.nested(() => {
      this.index++;
      return { kind: 'not', value: this.unary() };
    });
    if (this.take('(')) {
      const nested = this.nested(() => this.or());
      if (!this.take(')')) throw new ExpressionError(`Expected ) at ${this.token.at}`);
      return nested;
    }
    const token = this.token;
    if (token.kind === 'literal') { this.index++; return { kind: 'literal', value: token.value as Scalar }; }
    if (token.kind === 'variable') { this.index++; return { kind: 'variable', name: token.value as string }; }
    throw new ExpressionError(`Expected a value at ${token.at}`);
  }
  private depth(node: Expr): number {
    let max = 0;
    const stack: { node: Expr; depth: number }[] = [{ node, depth: 1 }];
    while (stack.length) {
      const current = stack.pop()!;
      max = Math.max(max, current.depth);
      if (current.depth > MAX_EXPRESSION_DEPTH) return current.depth;
      if (current.node.kind === 'not') stack.push({ node: current.node.value, depth: current.depth + 1 });
      else if (current.node.kind === 'binary') {
        stack.push({ node: current.node.left, depth: current.depth + 1 }, { node: current.node.right, depth: current.depth + 1 });
      }
    }
    return max;
  }
  private nested<T>(read: () => T): T {
    if (++this.nesting > MAX_EXPRESSION_DEPTH) throw new ExpressionError('Expression is too deeply nested');
    try { return read(); } finally { this.nesting--; }
  }
}

const compiled = new Map<string, Expr>();

export function compileExpression(source: string): Expr {
  const cached = compiled.get(source);
  if (cached) { compiled.delete(source); compiled.set(source, cached); return cached; }
  const expression = new Parser(tokenize(source)).parse();
  compiled.set(source, expression);
  if (compiled.size > 256) compiled.delete(compiled.keys().next().value!);
  return expression;
}

function boolean(value: VariableValue, at: string): boolean {
  if (typeof value !== 'boolean') throw new ExpressionError(`${at} requires a Boolean value`);
  return value;
}

function compare(op: '==' | '!=' | '>' | '<', left: VariableValue, right: VariableValue) {
  if (op === '==' || op === '!=') {
    if (typeof left !== typeof right) throw new ExpressionError('Compared values must have the same type');
    return op === '==' ? left === right : left !== right;
  }
  if (typeof left !== 'number' || typeof right !== 'number') throw new ExpressionError('Ordering requires numeric values');
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

export function evaluateExpression(source: string, valueOf: (name: string) => VariableValue | undefined) {
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
  if (predicate.kind === 'expression') return evaluateExpression(predicate.source, env.findVariable);
  const left = operand(predicate.left, env), right = operand(predicate.right, env);
  if ((predicate.left.kind === 'state' || predicate.right.kind === 'state') && predicate.op !== 'eq' && predicate.op !== 'ne')
    throw new ExpressionError('State values support equality only');
  return compare(predicate.op === 'eq' ? '==' : predicate.op === 'ne' ? '!=' : predicate.op === 'gt' ? '>' : '<', left, right);
}

import type { Scalar } from './scenario';

const MAX_EXPRESSION_SOURCE = 4096;
const MAX_EXPRESSION_DEPTH = 32;
export type Expr =
  | { kind: 'literal'; value: Scalar }
  | { kind: 'variable'; name: string }
  | { kind: 'not'; value: Expr }
  | { kind: 'binary'; op: '&&' | '||' | '==' | '!=' | '>' | '<'; left: Expr; right: Expr };
type Token = {
  kind: 'literal' | 'variable' | 'operator' | 'eof';
  value?: Scalar | string;
  at: number;
};

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '\\': '\\',
  '"': '"',
  "'": "'",
};

/** Reads the quoted string starting at `at`; returns its value and the index after the closing quote. */
function readString(source: string, at: number) {
  const quote = source[at];
  let value = '';
  for (let i = at + 1; i < source.length;) {
    const ch = source[i++];
    if (ch === quote) {
      return { value, end: i };
    }
    if (ch !== '\\') {
      value += ch;
      continue;
    }
    if (i >= source.length) {
      break;
    }
    const escaped = source[i++];
    if (!Object.hasOwn(ESCAPES, escaped)) {
      throw new ExpressionError(`Invalid string escape at ${i - 2}`);
    }
    value += ESCAPES[escaped];
  }
  throw new ExpressionError(`Unclosed string at ${at}`);
}

function tokenize(source: string): Token[] {
  if (source.length > MAX_EXPRESSION_SOURCE) throw new ExpressionError('Expression is too long');
  const tokens: Token[] = [];
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i])) {
      i++;
      continue;
    }
    const at = i;
    if (source[i] === '(' || source[i] === ')') {
      tokens.push({ kind: 'operator', value: source[i++], at });
      continue;
    }
    const pair = source.slice(i, i + 2);
    if (['&&', '||', '==', '!='].includes(pair)) {
      tokens.push({ kind: 'operator', value: pair, at });
      i += 2;
      continue;
    }
    if (['!', '>', '<'].includes(source[i])) {
      tokens.push({ kind: 'operator', value: source[i++], at });
      continue;
    }
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
      const string = readString(source, at);
      tokens.push({ kind: 'literal', value: string.value, at });
      i = string.end;
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
  private get token() {
    return this.tokens[this.index];
  }
  private take(value: string) {
    if (this.token.value !== value) return false;
    this.index++;
    return true;
  }
  parse(): Expr {
    const expression = this.or();
    if (this.token.kind !== 'eof')
      throw new ExpressionError(`Unexpected token at ${this.token.at}`);
    if (this.depth(expression) > MAX_EXPRESSION_DEPTH)
      throw new ExpressionError('Expression is too deeply nested');
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
    if (
      this.token.value === '==' ||
      this.token.value === '!=' ||
      this.token.value === '>' ||
      this.token.value === '<'
    ) {
      const op = this.token.value as '==' | '!=' | '>' | '<';
      this.index++;
      return { kind: 'binary', op, left, right: this.unary() };
    }
    return left;
  }
  private unary(): Expr {
    if (this.token.value === '!')
      return this.nested(() => {
        this.index++;
        return { kind: 'not', value: this.unary() };
      });
    if (this.take('(')) {
      const nested = this.nested(() => this.or());
      if (!this.take(')')) throw new ExpressionError(`Expected ) at ${this.token.at}`);
      return nested;
    }
    const token = this.token;
    if (token.kind === 'literal') {
      this.index++;
      return { kind: 'literal', value: token.value as Scalar };
    }
    if (token.kind === 'variable') {
      this.index++;
      return { kind: 'variable', name: token.value as string };
    }
    throw new ExpressionError(`Expected a value at ${token.at}`);
  }
  private depth(node: Expr): number {
    let max = 0;
    const stack: { node: Expr; depth: number }[] = [{ node, depth: 1 }];
    while (stack.length) {
      const current = stack.pop()!;
      max = Math.max(max, current.depth);
      if (current.depth > MAX_EXPRESSION_DEPTH) return current.depth;
      if (current.node.kind === 'not')
        stack.push({ node: current.node.value, depth: current.depth + 1 });
      else if (current.node.kind === 'binary') {
        stack.push(
          { node: current.node.left, depth: current.depth + 1 },
          { node: current.node.right, depth: current.depth + 1 },
        );
      }
    }
    return max;
  }
  private nested<T>(read: () => T): T {
    if (++this.nesting > MAX_EXPRESSION_DEPTH)
      throw new ExpressionError('Expression is too deeply nested');
    try {
      return read();
    } finally {
      this.nesting--;
    }
  }
}

const compiled = new Map<string, Expr>();

export function compileExpression(source: string): Expr {
  const cached = compiled.get(source);
  if (cached) {
    compiled.delete(source);
    compiled.set(source, cached);
    return cached;
  }
  const expression = new Parser(tokenize(source)).parse();
  compiled.set(source, expression);
  if (compiled.size > 256) compiled.delete(compiled.keys().next().value!);
  return expression;
}

import type { VariableValue } from './variables';

export type TemplateResult = { text: string; unknown: string[] };

export function renderTemplate(
  source: string,
  valueOf: (name: string) => VariableValue | undefined,
): TemplateResult {
  let text = '';
  const unknown = new Set<string>();
  for (let i = 0; i < source.length;) {
    if (source.startsWith('{{', i)) {
      text += '{';
      i += 2;
      continue;
    }
    if (source.startsWith('}}', i)) {
      text += '}';
      i += 2;
      continue;
    }
    if (source[i] !== '{') {
      text += source[i++];
      continue;
    }
    const close = source.indexOf('}', i + 1);
    if (close < 0) {
      text += source.slice(i);
      break;
    }
    const name = source.slice(i + 1, close).trim();
    if (!name) {
      text += source.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    const value = valueOf(name);
    if (value === undefined) {
      text += source.slice(i, close + 1);
      unknown.add(name);
    } else text += String(value);
    i = close + 1;
  }
  return { text, unknown: [...unknown] };
}

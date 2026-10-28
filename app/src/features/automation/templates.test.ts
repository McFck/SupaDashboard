import { describe, expect, it } from 'vitest';
import { renderTemplate } from './templates';

describe('safe templates', () => {
  it('renders Unicode values as plain text, supports escaped braces and keeps unknown tokens visible', () => {
    const values: Record<string, boolean | number | string> = {
      recording: true,
      count: 2,
      title: 'Музыка 🎧',
    };
    const result = renderTemplate('T{{{recording}}} · {title} · {unknown}', (name) => values[name]);
    expect(result).toEqual({ text: 'T{true} · Музыка 🎧 · {unknown}', unknown: ['unknown'] });
    expect(renderTemplate('{{literal}}', () => undefined)).toEqual({
      text: '{literal}',
      unknown: [],
    });
  });
});

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
  it('links only https URLs, so a guide cannot add script or file links', () => {
    const [block] = parseMarkdown(
      '[a](https://discord.com/developers) [b](javascript:run) [c](file:///C:/x) [d](http://x.test)',
    );
    expect(block).toEqual({
      kind: 'paragraph',
      inline: [
        { kind: 'link', text: 'a', href: 'https://discord.com/developers' },
        { kind: 'text', text: ' ' },
        { kind: 'text', text: 'b' },
        { kind: 'text', text: ' ' },
        { kind: 'text', text: 'c' },
        { kind: 'text', text: ' ' },
        { kind: 'text', text: 'd' },
      ],
    });
  });
});

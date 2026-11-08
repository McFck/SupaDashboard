// The Markdown subset plugin guides use: headings, paragraphs, lists, bold, inline code and https links.
// Parsed into data, never HTML, so a guide cannot inject markup.

export type Inline =
  { kind: 'text' | 'strong' | 'code'; text: string } | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'heading'; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] };

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

function isHttps(href: string) {
  try {
    return new URL(href).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) {
      out.push({ kind: 'text', text: text.slice(last, match.index) });
    }
    const [, strong, code, label, href] = match;
    if (strong !== undefined) {
      out.push({ kind: 'strong', text: strong });
    } else if (code !== undefined) {
      out.push({ kind: 'code', text: code });
    } else {
      out.push(isHttps(href) ? { kind: 'link', text: label, href } : { kind: 'text', text: label });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    out.push({ kind: 'text', text: text.slice(last) });
  }
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) });
    }
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
    }
    paragraph = [];
    list = undefined;
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^#{1,3}\s+(.*)$/.exec(line);
    const item = /^(\d+\.|[-*])\s+(.*)$/.exec(line);
    if (!line || heading) {
      flush();
      if (heading) {
        blocks.push({ kind: 'heading', inline: parseInline(heading[1]) });
      }
    } else if (item) {
      const ordered = item[1] !== '-' && item[1] !== '*';
      if (paragraph.length || (list && list.ordered !== ordered)) {
        flush();
      }
      list ??= { ordered, items: [] };
      list.items.push(item[2]);
    } else if (list && raw.startsWith(' ')) {
      list.items[list.items.length - 1] += ` ${line}`;
    } else {
      if (list) {
        flush();
      }
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

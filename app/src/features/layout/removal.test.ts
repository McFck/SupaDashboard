import { describe, expect, it } from 'vitest';
import { registerRemovalNode, removeItem } from './removal';

const view = (id: string, events: string[], name: string) =>
  registerRemovalNode({ isConnected: false } as HTMLElement, id, {
    start: () => events.push(`${name} start`),
    cancel: () => events.push(`${name} cancel`),
  });

describe('item removal', () => {
  it('commits a removal requested twice only once', async () => {
    const id = `once-${Math.random()}`;
    const events: string[] = [];
    const registration = view(id, events, 'grid');
    let commits = 0;
    const first = removeItem(id, () => ++commits > 0);
    const second = removeItem(id, () => ++commits > 0);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(commits).toBe(1);
    expect(events).toEqual(['grid start']);
    registration.destroy();
  });

  it('gives every view back when the removal is not committed', async () => {
    const id = `cancel-${Math.random()}`;
    const events: string[] = [];
    const editor = view(id, events, 'editor');
    const deck = view(id, events, 'deck');
    expect(await removeItem(id, () => false)).toBe(false);
    expect(events).toEqual(['editor start', 'deck start', 'editor cancel', 'deck cancel']);
    expect(await removeItem(id, () => true)).toBe(true);
    editor.destroy();
    deck.destroy();
  });
});

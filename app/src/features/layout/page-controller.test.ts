import { expect, it } from 'vitest';
import { DEFAULTS } from '../settings/defaults';
import { PageController } from './page-controller';

function fixture() {
  const deck = structuredClone(DEFAULTS.deck);
  deck.pages = ['a', 'b', 'c'].map((id) => ({ ...deck.pages[0], id, items: [] }));
  deck.activePage = 'a';
  const pages = new PageController({
    getDeck: () => deck,
    isOwner: () => true,
    onChange: () => {},
    emitEvent: async () => {},
    onEventFailure: () => {},
  });
  return { deck, pages };
}

it('toggles back to the page left by real navigation without remembering no-op changes', () => {
  const { pages } = fixture();
  expect(pages.back()).toBe(false);
  pages.changeInDirection('next', 'swipe');
  pages.change('c', 'action');
  expect(pages.change('c')).toBe(false);
  expect(pages.change('missing')).toBe(false);
  expect(pages.back()).toBe(true);
  expect(pages.activePage).toBe('b');
  expect(pages.back()).toBe(true);
  expect(pages.activePage).toBe('c');
});

it('ignores a deleted remembered page and remembers subsequent navigation', () => {
  const { deck, pages } = fixture();
  pages.change('b', 'swipe');
  deck.pages = deck.pages.filter((page) => page.id !== 'a');
  pages.reconcile();
  expect(pages.back()).toBe(false);
  expect(pages.activePage).toBe('b');
  pages.change('c', 'action');
  expect(pages.back()).toBe(true);
  expect(pages.activePage).toBe('b');
});

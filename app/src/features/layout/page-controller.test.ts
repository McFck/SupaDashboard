import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../settings/defaults';
import type { Page } from '../settings/schema';
import { PageController } from './page-controller';

const makePage = (id: string, extra: Partial<Page> = {}): Page => ({
  ...structuredClone(DEFAULTS.deck.pages[0]),
  id,
  name: id,
  items: [],
  ...extra,
});

function createController(pages: Page[], activePage = pages[0].id) {
  const deck = { pages, activePage };
  const events: { page: string; reason: string }[] = [];
  const controller = new PageController({
    getDeck: () => deck,
    isOwner: () => true,
    onChange: () => {},
    emitEvent: async (_id, _param, payload) => {
      const data = payload as { page: string; reason: string };
      events.push({ page: data.page, reason: data.reason });
    },
    onEventFailure: () => {},
  });
  return { deck, controller, events };
}

describe('page navigation controller', () => {
  it('skips hidden sub-pages during directional navigation and unwinds nested back history', () => {
    const { controller } = createController([
      makePage('main'),
      makePage('sub', { hidden: true }),
      makePage('media'),
      makePage('deep', { hidden: true }),
    ]);

    expect(controller.activePage).toBe('main');
    expect(controller.changeInDirection('next', 'action')).toBe(true);
    expect(controller.activePage).toBe('media');

    // Drill into nested hidden sub-pages and pop back step by step.
    expect(controller.change('sub', 'action')).toBe(true);
    expect(controller.change('deep', 'action')).toBe(true);
    expect(controller.back()).toBe(true);
    expect(controller.activePage).toBe('sub');
    expect(controller.back()).toBe(true);
    expect(controller.activePage).toBe('media');
    expect(controller.back()).toBe(true);
    expect(controller.activePage).toBe('main');
    expect(controller.back()).toBe(false);
  });

  it('auto-switches on focused app, returns when unfocused, and never fights a manual swipe', () => {
    const { controller } = createController([
      makePage('main'),
      makePage('work', { apps: ['exe:C:\\Apps\\Code.exe'] }),
      makePage('media'),
    ]);

    // Focus bound app -> switches to work.
    expect(controller.syncFocusedApps(new Set(['exe:C:\\Apps\\Code.exe']))).toBe(true);
    expect(controller.activePage).toBe('work');

    // Unfocus -> returns to main.
    expect(controller.syncFocusedApps(new Set())).toBe(true);
    expect(controller.activePage).toBe('main');

    // Focus bound app again, then user manually swipes to media -> unfocusing must not snap back.
    expect(controller.syncFocusedApps(new Set(['exe:C:\\Apps\\Code.exe']))).toBe(true);
    expect(controller.activePage).toBe('work');
    expect(controller.change('media', 'swipe')).toBe(true);
    expect(controller.syncFocusedApps(new Set())).toBe(false);
    expect(controller.activePage).toBe('media');
  });
});

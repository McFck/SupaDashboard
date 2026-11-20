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

const envWith = (vars: Record<string, boolean | string | number>) => ({
  getVariable: (id: string) => vars[id],
  findVariable: (name: string) => vars[name],
  getState: () => undefined,
});

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

  it('auto-switches on matching condition rules, respects returnOnLeave, and never fights a manual swipe', () => {
    const codeFocused = {
      kind: 'compare' as const,
      left: { kind: 'variable' as const, id: 'app.code.focused' },
      op: 'eq' as const,
      right: { kind: 'literal' as const, value: true },
    };
    const { controller } = createController([
      makePage('main'),
      makePage('work', { autoSwitch: { rules: [codeFocused], returnOnLeave: true } }),
      makePage('media'),
    ]);

    expect(controller.syncAutoSwitch(envWith({ 'app.code.focused': true }))).toBe(true);
    expect(controller.activePage).toBe('work');

    expect(controller.syncAutoSwitch(envWith({ 'app.code.focused': false }))).toBe(true);
    expect(controller.activePage).toBe('main');

    expect(controller.syncAutoSwitch(envWith({ 'app.code.focused': true }))).toBe(true);
    expect(controller.activePage).toBe('work');
    expect(controller.change('media', 'swipe')).toBe(true);
    expect(controller.syncAutoSwitch(envWith({ 'app.code.focused': false }))).toBe(false);
    expect(controller.activePage).toBe('media');
  });
});

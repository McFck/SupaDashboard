import { describe, expect, it } from 'vitest';
import type { ControlConfig } from '../model';
import { beginPull, pullBindingsFor, updatePull } from './pull';

const prev: ControlConfig = {
  id: 'prev',
  name: 'Previous',
  type: 'button',
  variants: [
    { id: 'all-media', label: 'All media' },
    { id: 'spotify', label: 'Spotify' },
  ],
  scenario: {
    triggers: {
      swipeDown: {
        steps: [
          {
            id: 'next',
            kind: 'action',
            action: { id: 'button.variant', args: { target: 'self', variant: 'next' } },
          },
        ],
      },
      swipeUp: {
        steps: [
          {
            id: 'prev',
            kind: 'action',
            action: { id: 'button.variant', args: { target: 'self', variant: 'prev' } },
          },
        ],
      },
    },
    events: [],
  },
};

describe('configured pull state', () => {
  it('uses an 8px slop, locks the dominant axis once, and never redirects an unbound pull', () => {
    const bindings = pullBindingsFor(prev, 0);
    const start = beginPull(1, 0, 0, 0, 200, 200);
    const seven = updatePull(start, 7, 0, bindings);
    expect(seven.state.movedBeyondSlop).toBe(false);
    expect(seven.snapshot).toBeNull();

    const diagonal = updatePull(start, 20, 15, bindings);
    expect(diagonal.state.lockedAxis).toBe('x');
    expect(diagonal.snapshot).toBeNull(); // right is unbound; down does not steal the pull
    const later = updatePull(diagonal.state, 100, 120, bindings);
    expect(later.state.lockedAxis).toBe('x');
    expect(later.snapshot).toBeNull();
    expect(updatePull(start, 80, 0, bindings).snapshot).toBeNull();
  });

  it('breaks an exact diagonal tie toward y, then ignores later cross-axis movement', () => {
    const bindings = { swipeDown: pullBindingsFor(prev, 0).swipeDown };
    const first = updatePull(beginPull(2, 0, 0, 0, 200, 200), 8, 8, bindings);
    expect(first.state.lockedAxis).toBe('y');
    expect(first.snapshot).toMatchObject({ direction: 'swipeDown', axis: 'y', offset: 8 });
    const later = updatePull(first.state, 100, 20, bindings);
    expect(later.state.lockedAxis).toBe('y');
    expect(later.snapshot).toMatchObject({ direction: 'swipeDown', offset: 20 });
    expect(updatePull(later.state, 100, -100, bindings).snapshot).toBeNull(); // up is not configured
  });

  it('arms at a quarter of the axis, clamped to 20–48px, and only hands off a current variant', () => {
    const bindings = pullBindingsFor(prev, 0);
    const start = beginPull(3, 0, 0, 0, 200, 200);
    expect(updatePull(start, 0, 47.99, bindings).snapshot?.armed).toBe(false);
    const armed = updatePull(start, 0, 48, bindings);
    expect(armed.snapshot).toMatchObject({ threshold: 48, distance: 48, progress: 1, armed: true });
    expect(updatePull(beginPull(3, 0, 0, 0, 40, 40), 0, 20, bindings).snapshot?.threshold).toBe(20);
    expect(updatePull(beginPull(3, 0, 0, 0, 120, 120), 0, 30, bindings).snapshot?.threshold).toBe(
      30,
    );
    expect(updatePull(beginPull(3, 0, 0, 0, 300, 300), 0, 48, bindings).snapshot?.threshold).toBe(
      48,
    );
    const overshoot = updatePull(armed.state, 0, 58, bindings);
    expect(overshoot.snapshot?.armed).toBe(true);
    const reversedBelowThreshold = updatePull(overshoot.state, 0, 47.99, bindings);
    expect(reversedBelowThreshold.snapshot?.armed).toBe(false);
  });

  it('halves variant and scenario travel limits and bounds their rubber tails', () => {
    const scenarioControl: ControlConfig = {
      ...prev,
      scenario: {
        triggers: {
          swipeDown: {
            steps: [{ id: 'toggle', kind: 'action', action: { id: 'media.toggle' } }],
          },
        },
        events: [],
      },
    };
    const scenario = updatePull(
      beginPull(4, 0, 0, 0, 200, 200),
      0,
      100,
      pullBindingsFor(scenarioControl, 0),
    ).snapshot!;
    expect(scenario.effect).toEqual({ kind: 'scenario', trigger: 'swipeDown', title: 'Pull Down' });
    expect(scenario.offset).toBeGreaterThan(25); // E/8 is 25px.
    expect(scenario.offset).toBeLessThan(34); // no more than the stated 0.18*T rubber tail.
    const variant = updatePull(
      beginPull(4, 0, 0, 0, 200, 200),
      0,
      100,
      pullBindingsFor(prev, 0),
    ).snapshot!;
    expect(variant.effect.kind).toBe('variant');
    expect(variant.offset).toBeGreaterThan(50); // E/4 is 50px.
    expect(variant.offset).toBeLessThan(59);
  });

  it('keeps bindings resolving to the active variant out of the pull map', () => {
    const one: ControlConfig = {
      ...prev,
      variants: [{ id: 'only', label: 'Only' }],
      scenario: {
        triggers: {
          swipeDown: {
            steps: [
              {
                id: 'next',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'self', variant: 'next' } },
              },
            ],
          },
        },
        events: [],
      },
    };
    expect(pullBindingsFor(one, 0)).toEqual({});
  });

  it('uses canonical pull scenarios and previews only one unconditional self state change', () => {
    const simple: ControlConfig = {
      ...prev,
      scenario: {
        triggers: {
          swipeRight: {
            steps: [
              {
                id: 'step',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'self', variant: 'next' } },
              },
            ],
          },
        },
        events: [],
      },
    };
    expect(pullBindingsFor(simple, 0).swipeRight).toEqual({ kind: 'variant', variant: 1 });

    const scenario: ControlConfig = {
      ...simple,
      scenario: {
        triggers: {
          swipeRight: {
            steps: [
              {
                id: 'first',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'self', variant: 'next' } },
              },
              { id: 'second', kind: 'action', action: { id: 'media.toggle' } },
            ],
          },
        },
        events: [],
      },
    };
    expect(pullBindingsFor(scenario, 0).swipeRight).toEqual({
      kind: 'scenario',
      trigger: 'swipeRight',
      title: 'Pull Right',
    });

    const emptyOverride: ControlConfig = {
      ...simple,
      scenario: {
        triggers: {
          swipeRight: {
            steps: [
              {
                id: 'base',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'self', variant: 'next' } },
              },
            ],
            byState: { 'all-media': [] },
          },
        },
        events: [],
      },
    };
    expect(pullBindingsFor(emptyOverride, 0).swipeRight).toMatchObject({ kind: 'scenario' });
  });
});

import { describe, expect, it } from 'vitest';
import type { ControlConfig } from './model';
import { moveVariant, removeVariant } from './variants';

describe('moveVariant', () => {
  it('reorders states and remaps the current index without changing stable scenario references', () => {
    const c = {
      id: 'c',
      name: 'c',
      type: 'button',
      variants: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
      scenario: {
        triggers: {
          press: {
            steps: [
              {
                id: 'state',
                kind: 'action' as const,
                action: { id: 'button.variant', args: { target: 'self', variant: 'state-1' } },
              },
            ],
          },
        },
        events: [],
      },
    } as ControlConfig;
    expect(moveVariant(c, 0, 0, 2)).toBe(2);
    expect(c.variants.map((v) => v.label)).toEqual(['b', 'c', 'a']);
    expect(c.scenario?.triggers.press?.steps[0]).toMatchObject({
      action: { args: { variant: 'state-1' } },
    });
    expect(moveVariant(c, 1, 2, 0)).toBe(2);
    expect(c.variants.map((v) => v.label)).toEqual(['a', 'b', 'c']);
    expect(moveVariant(c, 1, 0, 5)).toBe(1);
  });

  it('keeps stable scenario references through reorder and repairs only deleted self targets', () => {
    const c: ControlConfig = {
      id: 'b',
      name: 'b',
      type: 'button',
      variants: [
        { id: 'off', label: 'Off' },
        { id: 'on', label: 'On' },
        { id: 'idle', label: 'Idle' },
      ],
      scenario: {
        triggers: {
          press: {
            steps: [
              {
                id: 'self',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'self', variant: 'off' } },
              },
            ],
            byState: { off: [], on: [] },
          },
          release: {
            steps: [
              {
                id: 'external',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'other', variant: 'off' } },
              },
            ],
          },
        },
        events: [],
      },
      stateBindings: [
        {
          variableId: 'flag',
          cases: [
            { value: false, stateId: 'off' },
            { value: true, stateId: 'on' },
          ],
        },
      ],
      stateRoles: { off: 'off', on: 'on' },
    };
    expect(moveVariant(c, 0, 0, 2)).toBe(2);
    expect(c.scenario?.triggers.press?.byState).toEqual({ off: [], on: [] });
    expect(c.scenario?.triggers.press?.steps[0]).toMatchObject({
      action: { args: { variant: 'off' } },
    });
    expect(removeVariant(c, 2, 2)).toBe(1);
    expect(c.variants.map((variant) => variant.id)).toEqual(['on', 'idle']);
    expect(c.scenario?.triggers.press?.byState).toEqual({ on: [] });
    expect(c.scenario?.triggers.press?.steps[0]).toMatchObject({
      action: { args: { variant: 'idle' } },
    });
    expect(c.scenario?.triggers.release?.steps[0]).toMatchObject({
      action: { args: { target: 'other', variant: 'off' } },
    });
    expect(c.stateBindings?.[0].cases).toEqual([{ value: true, stateId: 'on' }]);
    expect(c.stateRoles).toBeUndefined();
  });
});

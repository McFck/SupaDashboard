import { describe, expect, it } from 'vitest';
import { migrate } from './normalize';

describe('settings v15 effects', () => {
  it('keeps known effects and gives the gesture ownership across nested and per-state actions', () => {
    const input = {
      version: 14,
      controls: [
        {
          id: 'tile',
          type: 'button',
          variants: [],
          scenario: {
            triggers: {
              press: {
                effect: 'hearts',
                steps: [
                  { id: 'a', kind: 'action', action: { id: 'app.open' }, effect: 'lightning' },
                ],
                byState: {
                  on: [
                    {
                      id: 'b',
                      kind: 'if',
                      effect: 'snow',
                      condition: {},
                      then: [{ id: 'c', kind: 'delay', ms: 1, effect: 'fire' }],
                      else: [],
                    },
                  ],
                },
              },
              release: {
                effect: 'unknown',
                steps: [
                  { id: 'd', kind: 'action', action: { id: 'app.open' }, effect: 'sparkles' },
                  { id: 'e', kind: 'delay', ms: 0, effect: 'unknown' },
                ],
              },
            },
            events: [
              {
                id: 'event',
                eventId: 'page.changed',
                list: {
                  effect: 'glow',
                  steps: [{ id: 'f', kind: 'delay', ms: 0, effect: 'ripple' }],
                },
              },
            ],
          },
        },
      ],
    };
    const saved = migrate(input);
    const scenario = saved.controls[0].scenario;
    expect(saved.version).toBe(23);
    expect(scenario?.triggers.press?.effect).toBe('hearts');
    expect(JSON.stringify(scenario?.triggers.press)).not.toMatch(/lightning|snow|fire/);
    expect(scenario?.triggers.release?.effect).toBeUndefined();
    expect(scenario?.triggers.release?.steps.map((step) => step.effect)).toEqual([
      'sparkles',
      undefined,
    ]);
    expect(scenario?.events[0].list.effect).toBe('glow');
    expect(scenario?.events[0].list.steps[0].effect).toBeUndefined();
    expect(migrate(saved)).toEqual(saved);
    expect(input.controls[0].scenario.triggers.press.steps[0].effect).toBe('lightning');
  });
});

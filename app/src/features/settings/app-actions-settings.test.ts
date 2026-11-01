import { describe, expect, it } from 'vitest';
import { migrate } from './normalize';
import { walkSteps } from '../automation/scenario';

describe('settings v13 app window selection', () => {
  it('defaults legacy and nested app actions without replacing saved selections', () => {
    const action = (id: string, args = {}) => ({ id, args: { app: 'aumid:Steam', ...args } });
    const step = (id: string, args = {}) => ({ id, kind: 'action', action: action(id, args) });
    const input = {
      version: 12,
      controls: [
        { id: 'legacy', type: 'button', variants: [{ action: action('app.toggle') }] },
        {
          id: 'app.toggle',
          type: 'button',
          variants: [],
          scenario: {
            triggers: {
              press: {
                steps: [
                  {
                    id: 'if',
                    kind: 'if',
                    condition: {},
                    then: [step('app.focus')],
                    else: [step('app.minimize', { windows: 'title', title: 'Friends' })],
                  },
                ],
                byState: { on: [step('app.toggle')] },
              },
            },
            events: [{ id: 'event', eventId: 'test', list: { steps: [step('app.minimize')] } }],
          },
        },
      ],
    };
    const original = structuredClone(input);
    const saved = migrate(input);
    const args: Record<string, unknown>[] = [];
    for (const control of saved.controls) {
      if (control.scenario) {
        walkSteps(control.scenario, (step) => {
          if (step.kind === 'action') {
            args.push(step.action.args ?? {});
          }
        });
      }
    }
    expect(args).toHaveLength(5);
    expect(args.filter((arg) => arg.windows === 'all' && arg.title === '')).toHaveLength(4);
    expect(args).toContainEqual({ app: 'aumid:Steam', windows: 'title', title: 'Friends' });
    expect(migrate(saved)).toEqual(saved);
    expect(saved.controls[1]).not.toHaveProperty('args');
    expect(input).toEqual(original);
  });
});

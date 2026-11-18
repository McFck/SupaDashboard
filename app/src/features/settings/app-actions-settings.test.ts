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

describe('settings v18 Spotify launch actions', () => {
  it('keeps legacy, nested, state and event launch actions working without changing other actions', () => {
    const launch = (id: string) => ({ id, kind: 'action', action: { id: 'spotify.open' } });
    const other = { id: 'open', args: { url: 'https://example.com' } };
    const input = {
      version: 17,
      controls: [
        { id: 'legacy', type: 'button', variants: [{ action: { id: 'spotify.open' } }] },
        {
          id: 'lyrics',
          type: 'button',
          variants: [],
          scenario: {
            triggers: {
              press: {
                steps: [
                  launch('plain'),
                  {
                    id: 'branch',
                    kind: 'if',
                    condition: {},
                    then: [launch('nested')],
                    else: [{ id: 'other', kind: 'action', action: other }],
                  },
                ],
                byState: { on: [launch('state')] },
              },
            },
            events: [{ id: 'event', eventId: 'test', list: { steps: [launch('event-step')] } }],
          },
        },
      ],
    };
    const original = structuredClone(input);
    const saved = migrate(input);
    const actions: unknown[] = [];
    for (const control of saved.controls) {
      if (control.scenario) {
        walkSteps(control.scenario, (step) => {
          if (step.kind === 'action') {
            actions.push(step.action);
          }
        });
      }
    }
    expect(saved.version).toBe(21);
    expect(actions).toEqual([
      { id: 'open', args: { url: 'spotify:' } },
      { id: 'open', args: { url: 'spotify:' } },
      { id: 'open', args: { url: 'spotify:' } },
      other,
      { id: 'open', args: { url: 'spotify:' } },
      { id: 'open', args: { url: 'spotify:' } },
    ]);
    expect(input).toEqual(original);
    expect(migrate(saved)).toEqual(saved);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeControl } from './normalize-control';
import { validateScenario } from './validate';

const action = (id: string, args?: Record<string, unknown>) => ({ id, ...(args ? { args } : {}) });

describe('canonical scenario migration', () => {
  it('moves per-state actions into stable overrides and flattens only built-in sequences', () => {
    const old = {
      id: 'button',
      name: 'Button',
      type: 'button',
      variants: [
        {
          label: '',
          action: action('sequence', {
            steps: [
              action('plugin.first'),
              action('delay', { ms: 25 }),
              action('sequence', { steps: [action('plugin.last')] }),
            ],
          }),
        },
        { label: 'Spotify', action: action('plugin.other', { token: 'kept' }) },
      ],
      gestures: {
        swipeUp: { variant: 'next' },
        swipeDown: { variant: 1 },
        doubleTap: action('sequence', { steps: [] }),
      },
    };
    const source = structuredClone(old);
    const control = normalizeControl(old);
    expect(old).toEqual(source);
    expect(control.variants.map((variant) => variant.id)).toEqual(['state-1', 'state-2']);
    expect(control.variants.every((variant) => variant.action === undefined)).toBe(true);
    expect(control.gestures).toBeUndefined();
    expect(control.scenario?.triggers.press?.steps).toEqual([]);
    expect(
      control.scenario?.triggers.press?.byState?.['state-1']?.map((step) => step.kind),
    ).toEqual(['action', 'delay', 'action']);
    expect(control.scenario?.triggers.press?.byState?.['state-1']?.map((step) => step.id)).toEqual([
      'press-1-1',
      'press-1-2',
      'press-1-3-1',
    ]);
    expect(control.scenario?.triggers.press?.byState?.['state-2']?.[0]).toMatchObject({
      kind: 'action',
      action: { id: 'plugin.other', args: { token: 'kept' } },
    });
    expect(control.scenario?.triggers.doubleTap).toBeUndefined();
    expect(control.scenario?.triggers.swipeUp?.steps[0]).toMatchObject({
      kind: 'action',
      action: { id: 'button.variant', args: { target: 'self', variant: 'next' } },
    });
    expect(control.scenario?.triggers.swipeDown?.steps[0]).toMatchObject({
      kind: 'action',
      action: { id: 'button.variant', args: { target: 'self', variant: 'state-2' } },
    });
    expect(normalizeControl(control)).toEqual(control);
  });

  it('drops empty trigger lists so a removed gesture stops delaying presses', () => {
    const control = normalizeControl({
      id: 'c',
      name: 'Button',
      type: 'button',
      variants: [{ label: 'A' }],
      scenario: {
        triggers: { doubleTap: { steps: [] }, press: { steps: [], effect: 'ripple' } },
        events: [],
      },
    });
    expect(control.scenario?.triggers.doubleTap).toBeUndefined();
  });

  it('stores identical variant action lists once in the common list', () => {
    const control = normalizeControl({
      id: 'b',
      name: 'Button',
      type: 'button',
      variants: [
        {
          label: 'Off',
          action: action('media.toggle', { source: 'spotify', nested: { b: 2, a: 1 } }),
        },
        {
          label: 'On',
          action: action('media.toggle', { nested: { a: 1, b: 2 }, source: 'spotify' }),
        },
      ],
    });
    expect(control.scenario?.triggers.press?.steps).toMatchObject([
      {
        kind: 'action',
        action: { id: 'media.toggle', args: { source: 'spotify', nested: { a: 1, b: 2 } } },
      },
    ]);
    expect(control.scenario?.triggers.press?.byState).toBeUndefined();
  });

  it('uses an explicit tap list once and keeps arbitrary plugin args.steps opaque', () => {
    const control = normalizeControl({
      id: 'b',
      name: 'Button',
      type: 'button',
      variants: [
        { label: 'A', action: action('media.toggle') },
        { label: 'B', action: action('media.prev') },
      ],
      gestures: {
        tap: action('plugin.run', { steps: [action('media.next')] }),
        swipeLeft: { variant: 0 },
      },
    });
    expect(control.scenario?.triggers.press).toEqual({
      steps: [
        {
          id: 'press',
          kind: 'action',
          action: { id: 'plugin.run', args: { steps: [action('media.next')] } },
        },
      ],
    });
    expect(control.scenario?.triggers.swipeLeft?.steps[0]).toMatchObject({
      kind: 'action',
      action: { id: 'button.variant', args: { target: 'self', variant: 'state-1' } },
    });
    expect(Object.keys(control.scenario?.triggers.press?.byState ?? {})).toHaveLength(0);
  });

  it.each(['press', 'state', 'event'] as const)(
    'stored sequence/delay steps flatten into the step tree (%s)',
    (owner) => {
      const steps = [
        {
          id: 'old',
          kind: 'action',
          action: action('sequence', {
            steps: [
              action('plugin.first', { steps: [action('delay', { ms: 99 })] }),
              action('sequence', {
                steps: [action('delay', { ms: 25 }), action('media.nextSlide')],
              }),
              action('media.prevSlide', { target: 'slideshow' }),
            ],
          }),
        },
      ];
      const list = owner === 'state' ? { steps: [], byState: { off: steps } } : { steps };
      const saved = {
        id: 'b',
        name: 'Button',
        type: 'button',
        variants: [{ id: 'off', label: '' }],
        scenario: {
          triggers: owner === 'event' ? {} : { press: list },
          events: owner === 'event' ? [{ id: 'listener', eventId: 'test', list }] : [],
        },
      };
      const source = structuredClone(saved);
      const control = normalizeControl(saved);
      const result =
        owner === 'event'
          ? control.scenario!.events[0].list.steps
          : owner === 'state'
            ? control.scenario!.triggers.press!.byState!.off
            : control.scenario!.triggers.press!.steps;
      expect(result).toMatchObject([
        {
          kind: 'action',
          action: action('plugin.first', { steps: [action('delay', { ms: 99 })] }),
        },
        { kind: 'delay', ms: 25 },
        { kind: 'action', action: action('media.next', { target: 'self' }) },
        { kind: 'action', action: action('media.prev', { target: 'slideshow' }) },
      ]);
      expect(validateScenario(control.scenario)).toEqual([]);
      expect(normalizeControl(control)).toEqual(control);
      expect(saved).toEqual(source);
    },
  );

  it('detects node/depth/duplicate-id/delay violations without trimming the scenario', () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({
      id: `s${i}`,
      kind: 'action',
      action: action('plugin.x'),
    }));
    const deep = (level: number): any =>
      level === 0
        ? []
        : [
            {
              id: `d${level}`,
              kind: 'if',
              condition: { kind: 'expression', source: 'true' },
              then: deep(level - 1),
              else: [],
            },
          ];
    const issues = validateScenario({
      triggers: {
        press: {
          steps: [
            ...many,
            { id: 'dup', kind: 'delay', ms: 86_400_001 },
            { id: 'dup', kind: 'action', action: action('plugin.x') },
            ...deep(17),
          ],
        },
      },
      events: [],
    });
    expect(issues.some((issue) => issue.message === 'Scenario exceeds 1000 steps')).toBe(true);
    expect(issues.some((issue) => issue.message === 'Scenario exceeds 16 levels')).toBe(true);
    expect(issues.some((issue) => issue.message === 'Step IDs must be unique')).toBe(true);
    expect(issues.some((issue) => issue.message.startsWith('Wait duration'))).toBe(true);
  });

  it('rejects cyclic plugin control input instead of persisting a cycle', () => {
    const steps: unknown[] = [];
    steps.push({ id: 'sequence', args: { steps } });
    expect(() =>
      normalizeControl({
        id: 'b',
        name: 'Button',
        type: 'button',
        variants: [],
        gestures: { tap: action('sequence', { steps }) },
      }),
    ).toThrow('contains a cycle');
  });

  it('blocks malformed condition expressions and state ordering while preserving unavailable references', () => {
    const issues = validateScenario({
      triggers: {
        press: {
          steps: [
            {
              id: 'bad-expression',
              kind: 'if',
              condition: { kind: 'expression', source: 'globalThis.alert(1)' },
              then: [],
              else: [],
            },
            {
              id: 'bad-state-order',
              kind: 'if',
              condition: {
                kind: 'compare',
                left: { kind: 'state', controlId: 'missing-control' },
                op: 'gt',
                right: { kind: 'literal', value: 'state-1' },
              },
              then: [],
              else: [],
            },
            {
              id: 'unavailable-variable',
              kind: 'if',
              condition: {
                kind: 'compare',
                left: { kind: 'variable', id: 'missing-variable' },
                op: 'eq',
                right: { kind: 'literal', value: true },
              },
              then: [],
              else: [],
            },
          ],
        },
      },
      events: [],
    });
    expect(issues).toHaveLength(2);
    expect(issues.some((issue) => issue.message === 'State values support equality only')).toBe(
      true,
    );
  });
});

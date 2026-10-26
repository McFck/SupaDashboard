import { describe, expect, it } from 'vitest';
import { normalizeControl, selectTriggerSteps, validateScenario } from './scenario';

const action = (id: string, args?: Record<string, unknown>) => ({ id, ...(args ? { args } : {}) });

describe('canonical scenario migration', () => {
  it('moves per-state actions into stable overrides and flattens only built-in sequences', () => {
    const old = { id: 'button', name: 'Button', type: 'button', variants: [
      { label: '', action: action('sequence', { steps: [action('plugin.first'), action('delay', { ms: 25 }),
        action('sequence', { steps: [action('plugin.last')] })] }) },
      { label: 'Spotify', action: action('plugin.other', { token: 'kept' }) },
    ], gestures: { swipeUp: { variant: 'next' }, swipeDown: { variant: 1 }, doubleTap: action('sequence', { steps: [] }) } };
    const source = structuredClone(old);
    const control = normalizeControl(old);
    expect(old).toEqual(source);
    expect(control.variants.map(variant => variant.id)).toEqual(['state-1', 'state-2']);
    expect(control.variants.every(variant => variant.action === undefined)).toBe(true);
    expect(control.gestures).toBeUndefined();
    expect(control.scenario?.triggers.press?.steps).toEqual([]);
    expect(control.scenario?.triggers.press?.byState?.['state-1']?.map(step => step.kind)).toEqual(['action', 'delay', 'action']);
    expect(control.scenario?.triggers.press?.byState?.['state-1']?.map(step => step.id)).toEqual([
      'press-1-1', 'press-1-2', 'press-1-3-1',
    ]);
    expect(control.scenario?.triggers.press?.byState?.['state-2']?.[0]).toMatchObject({
      kind: 'action', action: { id: 'plugin.other', args: { token: 'kept' } },
    });
    expect(control.scenario?.triggers.doubleTap?.steps).toEqual([]);
    expect(control.scenario?.triggers.swipeUp?.steps[0]).toMatchObject({
      kind: 'action', action: { id: 'button.variant', args: { target: 'self', variant: 'next' } },
    });
    expect(control.scenario?.triggers.swipeDown?.steps[0]).toMatchObject({
      kind: 'action', action: { id: 'button.variant', args: { target: 'self', variant: 'state-2' } },
    });
    expect(normalizeControl(control)).toEqual(control);
  });

  it('stores identical variant action lists once in the common list', () => {
    const control = normalizeControl({ id: 'b', name: 'Button', type: 'button', variants: [
      { label: 'Off', action: action('media.toggle', { source: 'spotify', nested: { b: 2, a: 1 } }) },
      { label: 'On', action: action('media.toggle', { nested: { a: 1, b: 2 }, source: 'spotify' }) },
    ] });
    expect(control.scenario?.triggers.press?.steps).toMatchObject([
      { kind: 'action', action: { id: 'media.toggle', args: { source: 'spotify', nested: { a: 1, b: 2 } } } },
    ]);
    expect(control.scenario?.triggers.press?.byState).toBeUndefined();
  });

  it('uses an explicit tap list once and keeps arbitrary plugin args.steps opaque', () => {
    const control = normalizeControl({ id: 'b', name: 'Button', type: 'button', variants: [
      { label: 'A', action: action('media.toggle') }, { label: 'B', action: action('media.prev') },
    ], gestures: { tap: action('plugin.run', { steps: [action('media.next')] }), swipeLeft: { variant: 0 } } });
    expect(control.scenario?.triggers.press).toEqual({ steps: [{
      id: 'press', kind: 'action', action: { id: 'plugin.run', args: { steps: [action('media.next')] } },
    }] });
    expect(control.scenario?.triggers.swipeLeft?.steps[0]).toMatchObject({
      kind: 'action', action: { id: 'button.variant', args: { target: 'self', variant: 'state-1' } },
    });
    expect(Object.keys(control.scenario?.triggers.press?.byState ?? {})).toHaveLength(0);
  });

  it('preserves malformed built-in action refs as editable leaves and rejects their execution shape', () => {
    const control = normalizeControl({ id: 'b', name: 'Button', type: 'button', variants: [],
      gestures: { longPress: action('delay', { ms: -1 }), doubleTap: action('sequence', { steps: 'bad' }) } });
    expect(control.scenario?.triggers.longPress?.steps[0]).toMatchObject({ kind: 'action', action: { id: 'delay', args: { ms: -1 } } });
    expect(control.scenario?.triggers.doubleTap?.steps[0]).toMatchObject({ kind: 'action', action: { id: 'sequence', args: { steps: 'bad' } } });
    expect(validateScenario(control.scenario).map(issue => issue.message)).toContain('Wait duration must be an integer from 0 to 86400000');
    expect(validateScenario(control.scenario).map(issue => issue.message)).toContain('Action sequence is invalid');
  });

  it('honors an explicit empty state override instead of inheriting common steps', () => {
    const common = [{ id: 'common', kind: 'action' as const, action: action('media.toggle') }];
    const list = { steps: common, byState: { off: [] } };
    expect(selectTriggerSteps(list, 'off')).toEqual([]);
    expect(selectTriggerSteps(list, 'on')).toBe(common);
  });

  it('detects node/depth/duplicate-id/delay violations without trimming the scenario', () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({ id: `s${i}`, kind: 'action', action: action('plugin.x') }));
    const deep = (level: number): any => level === 0 ? [] : [{ id: `d${level}`, kind: 'if', condition: { kind: 'expression', source: 'true' },
      then: deep(level - 1), else: [] }];
    const issues = validateScenario({ triggers: { press: { steps: [
      ...many, { id: 'dup', kind: 'delay', ms: 86_400_001 }, { id: 'dup', kind: 'action', action: action('plugin.x') }, ...deep(17),
    ] } }, events: [] });
    expect(issues.some(issue => issue.message === 'Scenario exceeds 1000 steps')).toBe(true);
    expect(issues.some(issue => issue.message === 'Scenario exceeds 16 levels')).toBe(true);
    expect(issues.some(issue => issue.message === 'Step IDs must be unique')).toBe(true);
    expect(issues.some(issue => issue.message.startsWith('Wait duration'))).toBe(true);
    expect(many).toHaveLength(1001);
  });

  it('rejects cyclic plugin control input instead of persisting a cycle', () => {
    const steps: unknown[] = [];
    steps.push({ id: 'sequence', args: { steps } });
    expect(() => normalizeControl({ id: 'b', name: 'Button', type: 'button', variants: [],
      gestures: { tap: action('sequence', { steps }) } })).toThrow('contains a cycle');
  });

  it('blocks malformed condition expressions and state ordering while preserving unavailable references', () => {
    const issues = validateScenario({ triggers: { press: { steps: [
      { id: 'bad-expression', kind: 'if', condition: { kind: 'expression', source: 'globalThis.alert(1)' }, then: [], else: [] },
      { id: 'bad-state-order', kind: 'if', condition: { kind: 'compare', left: { kind: 'state', controlId: 'missing-control' },
        op: 'gt', right: { kind: 'literal', value: 'state-1' } }, then: [], else: [] },
      { id: 'unavailable-variable', kind: 'if', condition: { kind: 'compare', left: { kind: 'variable', id: 'missing-variable' },
        op: 'eq', right: { kind: 'literal', value: true } }, then: [], else: [] },
    ] } }, events: [] });
    expect(issues).toHaveLength(2);
    expect(issues[0].message).not.toBe('State values support equality only');
    expect(issues.some(issue => issue.message === 'State values support equality only')).toBe(true);
  });
});

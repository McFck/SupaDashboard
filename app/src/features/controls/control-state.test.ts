import { describe, expect, it } from 'vitest';
import { effectiveVariant } from './control-state';
import type { ControlConfig } from './model';
import { moveVariant, variantIndexForState } from './variants';
import { VariableStore } from '../automation/variables';

const control: ControlConfig = {
  id: 'b',
  name: 'Button',
  type: 'button',
  variants: [
    { id: 'off', label: 'Stopped', icon: null, background: null, color: '#aaa' },
    { id: 'on', label: 'Recording {count}', icon: 'Mic', background: '#123456', color: '#fff' },
  ],
  stateBinding: {
    variableId: 'recording',
    cases: [
      { value: false, stateId: 'off' },
      { value: true, stateId: 'on' },
    ],
  },
};

describe('effective button state', () => {
  it('binds by exact typed values and resolves labels without writing settings', () => {
    const variables = new VariableStore();
    variables.createUser({
      id: 'recording',
      name: 'recording',
      type: 'boolean',
      initialValue: true,
    });
    variables.createUser({ id: 'count', name: 'count', type: 'integer', initialValue: 2 });
    const before = structuredClone(control);
    expect(effectiveVariant(control, variables, 0)).toEqual({
      index: 1,
      stateId: 'on',
      view: {
        label: 'Recording 2',
        icon: 'Mic',
        color: '#fff',
        background: '#123456',
      },
    });
    expect(control).toEqual(before);
  });

  it('uses the manual fallback for missing variables, unmatched cases and stale targets', () => {
    const missing = effectiveVariant(control, undefined, 1);
    expect(missing).toMatchObject({ index: 1, stateId: 'on' });
    const variables = new VariableStore();
    variables.createUser({
      id: 'recording',
      name: 'recording',
      type: 'string',
      initialValue: 'false',
    });
    expect(effectiveVariant(control, variables, 0)).toMatchObject({ index: 0, stateId: 'off' });
    const stale = {
      ...control,
      stateBinding: { variableId: 'recording', cases: [{ value: true, stateId: 'deleted' }] },
    };
    variables.set('recording', 'true');
    expect(effectiveVariant(stale, variables, 1)).toMatchObject({ index: 1, stateId: 'on' });
    expect(effectiveVariant(stale, variables, 99)).toMatchObject({ index: 1, stateId: 'on' });
  });

  it('uses Off/On roles for booleans when explicit cases are absent', () => {
    const variables = new VariableStore();
    variables.createUser({ id: 'active', name: 'active', type: 'boolean', initialValue: false });
    const stateful = {
      ...control,
      stateBinding: { variableId: 'active', cases: [] },
      stateRoles: { off: 'off', on: 'on' },
    };
    expect(effectiveVariant(stateful, variables, 1)).toMatchObject({ index: 0, stateId: 'off' });
    variables.set('active', true);
    expect(effectiveVariant(stateful, variables, 0)).toMatchObject({ index: 1, stateId: 'on' });
  });

  it('keeps stable state identity and presentation through variant reorder', () => {
    const reordered = structuredClone(control);
    expect(moveVariant(reordered, 0, 0, 1)).toBe(1);
    expect(variantIndexForState(reordered, 'off')).toBe(1);
    const variables = new VariableStore();
    variables.createUser({
      id: 'recording',
      name: 'recording',
      type: 'boolean',
      initialValue: false,
    });
    expect(effectiveVariant(reordered, variables, 1)).toMatchObject({
      index: 1,
      stateId: 'off',
      view: {
        label: 'Stopped',
        icon: null,
        background: null,
      },
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { ControlConfig } from './model';
import { validateStateConfiguration } from './state-validation';
import { VariableStore } from '../automation/variables';

const control: ControlConfig = {
  id: 'b',
  name: 'Button',
  type: 'button',
  variants: [
    { id: 'off', label: 'Stopped', icon: null, background: null, color: '#aaa' },
    { id: 'on', label: 'Recording {count}', icon: 'Mic', background: '#123456', color: '#fff' },
  ],
  stateBindings: [
    {
      variableId: 'recording',
      cases: [
        { value: false, stateId: 'off' },
        { value: true, stateId: 'on' },
      ],
    },
  ],
};

describe('state configuration', () => {
  it('validates typed case values, duplicate mappings, and stale references', () => {
    const variables = new VariableStore();
    variables.createUser({
      id: 'recording',
      name: 'recording',
      type: 'boolean',
      initialValue: false,
    });
    expect(validateStateConfiguration(control, variables.snapshot())).toEqual([]);
    const invalid = {
      ...control,
      stateBindings: [
        {
          variableId: 'recording',
          cases: [
            { value: false, stateId: 'missing' },
            { value: false, stateId: 'on' },
            { value: 'true', stateId: 'off' },
          ],
        },
      ],
    };
    expect(
      validateStateConfiguration(invalid, variables.snapshot()).map((issue) => issue.message),
    ).toEqual([
      'Bound state is unavailable',
      'State values must be unique',
      'State value does not match the variable type',
    ]);
  });
});

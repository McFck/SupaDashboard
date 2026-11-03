import { describe, expect, it } from 'vitest';
import { migrate } from './normalize';

describe('settings v11 to v12', () => {
  it('turns a control single state binding into a one-item list', () => {
    const binding = { variableId: 'recording', cases: [{ value: true, stateId: 'on' }] };
    const migrated = migrate({
      version: 11,
      controls: [{ id: 'x', type: 'button', variants: [], stateBinding: binding }],
    });
    expect(migrated.version).toBe(15);
    expect(migrated.controls[0].stateBindings).toEqual([binding]);
    expect(migrated.controls[0]).not.toHaveProperty('stateBinding');
  });
});

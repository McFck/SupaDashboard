import { describe, expect, it } from 'vitest';
import { migrate } from './normalize';

describe('settings v11 to v12', () => {
  it('turns a control single state binding into a one-item list', () => {
    const binding = { variableId: 'recording', cases: [{ value: true, stateId: 'on' }] };
    const migrated = migrate({
      version: 11,
      controls: [{ id: 'x', type: 'button', variants: [], stateBinding: binding }],
    });
    expect(migrated.version).toBe(20);
    expect(migrated.controls[0].stateBindings).toEqual([binding]);
    expect(migrated.controls[0]).not.toHaveProperty('stateBinding');
  });
});

describe('settings v19 shuffle bindings', () => {
  it('preserves both boolean shuffle mappings and their precedence after combining the variables', () => {
    const input = {
      version: 18,
      controls: [
        {
          id: 'shuffle',
          type: 'button',
          variants: ['off', 'on', 'smart'].map((id) => ({ id, label: id })),
          stateBindings: [
            {
              variableId: 'spotify.smartShuffle',
              cases: [
                { value: true, stateId: 'smart' },
                { value: false, stateId: 'off' },
              ],
            },
            {
              variableId: 'spotify.shuffle',
              cases: [
                { value: false, stateId: 'off' },
                { value: true, stateId: 'on' },
              ],
            },
            { variableId: 'spotify.liked', cases: [{ value: true, stateId: 'on' }] },
          ],
        },
      ],
    };
    const original = structuredClone(input);
    const saved = migrate(input);
    expect(saved.controls[0].stateBindings).toEqual([
      {
        variableId: 'spotify.shuffle',
        cases: [
          { value: 'smart', stateId: 'smart' },
          { value: 'off', stateId: 'off' },
          { value: 'shuffle', stateId: 'off' },
        ],
      },
      {
        variableId: 'spotify.shuffle',
        cases: [
          { value: 'off', stateId: 'off' },
          { value: 'shuffle', stateId: 'on' },
          { value: 'smart', stateId: 'on' },
        ],
      },
      input.controls[0].stateBindings[2],
    ]);
    expect(migrate(saved)).toEqual(saved);
    expect(input).toEqual(original);
  });
});

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

describe('settings v20 Meet variables', () => {
  it('keeps saved Meet bindings and conditions working after the variables leave the work namespace', () => {
    const migrated = migrate({
      version: 19,
      controls: [
        {
          id: 'mic',
          type: 'button',
          variants: [{ id: 'on', label: '' }],
          stateBindings: [{ variableId: 'work.micOn', cases: [{ value: true, stateId: 'on' }] }],
          scenario: {
            triggers: {
              press: {
                steps: [
                  {
                    id: 'a',
                    kind: 'if',
                    condition: { kind: 'expression', source: 'work.inCall && !work.cameraOn' },
                    then: [{ id: 'b', kind: 'action', action: { id: 'work.toggleMic' } }],
                    else: [],
                  },
                ],
              },
            },
            events: [],
          },
        },
      ],
    });
    expect(migrated.version).toBe(20);
    const [control] = migrated.controls;
    expect(control.stateBindings?.[0].variableId).toBe('meet.micOn');
    const step = control.scenario?.triggers.press?.steps[0];
    expect(step?.kind === 'if' && step.condition).toEqual({
      kind: 'expression',
      source: 'meet.inCall && !meet.cameraOn',
    });
    expect(step?.kind === 'if' && step.then[0]).toMatchObject({
      action: { id: 'work.toggleMic' },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './defaults';
import { migrate } from './normalize';
import { appVariable } from '../apps/keys';

describe('saved apps', () => {
  it('upgrades window states to Main while preserving Running and saved window selections', () => {
    const variableId = appVariable('chat', 'visible', { windows: 'window', title: 'Friends List' });
    const scenario = {
      triggers: {
        press: {
          steps: [
            {
              id: 'if',
              kind: 'if',
              condition: {
                kind: 'compare',
                left: { kind: 'variable', id: variableId },
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
    };
    const input = {
      ...structuredClone(DEFAULTS),
      version: 13,
      controls: [
        {
          id: 'chat',
          type: 'button',
          variants: [],
          scenario,
          stateBindings: [
            { variableId: 'app.chat.focused', cases: [] },
            { variableId: 'app.chat.running', cases: [] },
          ],
        },
      ],
    };
    const saved = migrate(input);
    expect(saved.version).toBe(16);
    expect(saved.controls[0].stateBindings?.[0].variableId).toBe(
      appVariable('chat', 'focused', { windows: 'main', title: '' }),
    );
    expect(saved.controls[0].stateBindings?.[1].variableId).toBe('app.chat.running');
    expect(saved.controls[0].scenario).toEqual(scenario);
    expect(migrate(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(input.version).toBe(13);
    const legacy = structuredClone(input);
    legacy.controls[0].scenario.triggers.press.steps[0].condition.left.id = 'app.chat.visible';
    const migratedStep = migrate(legacy).controls[0].scenario?.triggers.press?.steps[0];
    expect(migratedStep?.kind === 'if' && migratedStep.condition).toMatchObject({
      left: { id: appVariable('chat', 'visible', { windows: 'main', title: '' }) },
    });
  });
  it('adds the manual app list when upgrading v10 and refuses a damaged one', () => {
    const { apps: _apps, ...v10 } = { ...structuredClone(DEFAULTS), version: 10 } as any;
    expect(migrate(v10).apps).toEqual([]);
    expect(migrate({ ...v10, version: 11, apps: ['exe:C:\a.exe', 'exe:C:\a.exe'] }).apps).toEqual([
      'exe:C:\a.exe',
    ]);
    expect(() => migrate({ ...v10, version: 11, apps: [1] })).toThrow('apps');
  });
});

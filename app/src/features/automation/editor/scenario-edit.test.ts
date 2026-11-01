import { describe, expect, it } from 'vitest';
import { scenarioNodeCount, walkSteps, type ActionStep } from '../scenario';
import type { ControlConfig } from '../../controls/model';
import {
  createScenarioDraft,
  insertScenarioStep,
  moveScenarioStep,
  moveScenarioStepTo,
  removeScenarioStep,
  replaceScenarioStep,
  sameScenarioDraft,
  shiftScenarioStep,
  type StepListPath,
} from './scenario-edit';

const control: ControlConfig = {
  id: 'button-a',
  name: 'Button A',
  type: 'button',
  variants: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  scenario: {
    triggers: {
      press: {
        steps: [
          {
            id: 'if-1',
            kind: 'if',
            condition: {
              kind: 'compare',
              left: { kind: 'literal', value: true },
              op: 'eq',
              right: { kind: 'literal', value: true },
            },
            then: [
              {
                id: 'then-1',
                kind: 'action',
                action: { id: 'plugin.action', args: { keep: 1, nested: { value: 2 } } },
              },
            ],
            else: [{ id: 'else-1', kind: 'delay', ms: 200 }],
          },
          { id: 'tail', kind: 'action', action: { id: 'media.toggle' } },
        ],
      },
    },
    events: [
      {
        id: 'listener',
        eventId: 'variables.changed',
        parameter: 'user:recording',
        list: { steps: [] },
      },
    ],
  },
};
const root: StepListPath = { kind: 'trigger', trigger: 'press' };
const thenPath: StepListPath = { ...root, branches: [{ stepId: 'if-1', arm: 'then' }] };

describe('scenario draft tree edits', () => {
  it('inserts at the requested position inside a branch without touching siblings', () => {
    const next = insertScenarioStep(
      control.scenario!,
      thenPath,
      { id: 'inserted', kind: 'delay', ms: 20 },
      0,
    );
    const parent = next.triggers.press!.steps[0];
    expect(parent.kind === 'if' && parent.then.map((step) => step.id)).toEqual([
      'inserted',
      'then-1',
    ]);
    expect(parent.kind === 'if' && parent.else).toEqual([{ id: 'else-1', kind: 'delay', ms: 200 }]);
    expect(() =>
      insertScenarioStep(control.scenario!, root, { id: 'bad', kind: 'delay', ms: 0 }, 3),
    ).toThrow(/position/);
  });
  it('reorders siblings without changing ids or step contents', () => {
    const next = moveScenarioStep(control.scenario!, root, 'tail', 0);
    expect(next.triggers.press?.steps.map((step) => step.id)).toEqual(['tail', 'if-1']);
    expect(next.triggers.press?.steps[1]).toEqual(control.scenario!.triggers.press!.steps[0]);
    expect(control.scenario!.triggers.press?.steps.map((step) => step.id)).toEqual([
      'if-1',
      'tail',
    ]);
  });

  it('edits nested Then and Else lists independently and preserves unknown action args', () => {
    const inserted = insertScenarioStep(control.scenario!, thenPath, {
      id: 'then-2',
      kind: 'action',
      action: { id: 'plugin.action', args: { extra: 'kept' } },
    });
    expect(
      inserted.triggers.press?.steps[0].kind === 'if' && inserted.triggers.press.steps[0].condition,
    ).toEqual(
      control.scenario!.triggers.press!.steps[0].kind === 'if' &&
        control.scenario!.triggers.press!.steps[0].condition,
    );
    expect(
      inserted.triggers.press?.steps[0].kind === 'if' &&
        inserted.triggers.press.steps[0].then.map((s) => s.id),
    ).toEqual(['then-1', 'then-2']);
    const replaced = replaceScenarioStep(inserted, thenPath, 'then-1', {
      id: 'new-id',
      kind: 'action',
      action: { id: 'plugin.other', args: { keep: 1, nested: { value: 2 } } },
    });
    const first = replaced.triggers.press?.steps[0];
    expect(first?.kind === 'if' && first.then[0]).toEqual({
      id: 'then-1',
      kind: 'action',
      action: { id: 'plugin.other', args: { keep: 1, nested: { value: 2 } } },
    });
    expect(first?.kind === 'if' && first.else).toEqual([{ id: 'else-1', kind: 'delay', ms: 200 }]);
  });

  it('removes only the selected subtree and rejects duplicate IDs', () => {
    const next = removeScenarioStep(control.scenario!, root, 'if-1');
    expect(next.triggers.press?.steps).toEqual([
      { id: 'tail', kind: 'action', action: { id: 'media.toggle' } },
    ]);
    expect(next.events[0]).toEqual(control.scenario!.events[0]);
    expect(() =>
      insertScenarioStep(control.scenario!, root, { id: 'then-1', kind: 'delay', ms: 0 }),
    ).toThrow(/unique/);
  });

  it('edits event trees and leaves unrelated controls out of the conflict signature', () => {
    const eventPath: StepListPath = { kind: 'event', eventId: 'listener' };
    const next = insertScenarioStep(control.scenario!, eventPath, {
      id: 'event-step',
      kind: 'delay',
      ms: 50,
    });
    expect(next.events[0].list.steps).toEqual([{ id: 'event-step', kind: 'delay', ms: 50 }]);
    const originalDraft = createScenarioDraft(control);
    const renamedControl = { ...control, name: 'Renamed' };
    expect(sameScenarioDraft(originalDraft, createScenarioDraft(renamedControl))).toBe(true);
    const changedControl = { ...control, scenario: next };
    expect(sameScenarioDraft(originalDraft, createScenarioDraft(changedControl))).toBe(false);
  });
});

describe('moving steps between lists', () => {
  const elsePath: StepListPath = { ...root, branches: [{ stepId: 'if-1', arm: 'else' }] };
  const ids = (scenario: typeof control.scenario) => {
    const all: string[] = [];
    walkSteps(scenario!, (step) => all.push(step.id));
    return all.sort();
  };
  const listOfIds = (scenario: NonNullable<typeof control.scenario>, path: StepListPath) => {
    let steps: ActionStep[] = scenario.triggers.press!.steps;
    for (const branch of path.branches ?? []) {
      const parent = steps.find((step) => step.id === branch.stepId);
      steps = parent?.kind === 'if' ? parent[branch.arm] : [];
    }
    return steps.map((step) => step.id);
  };

  it('moves a step into a branch and back out without losing or duplicating anything', () => {
    const into = moveScenarioStepTo(control.scenario!, root, 'tail', thenPath, 1);
    expect(listOfIds(into, root)).toEqual(['if-1']);
    expect(listOfIds(into, thenPath)).toEqual(['then-1', 'tail']);
    const out = moveScenarioStepTo(into, thenPath, 'then-1', root, 0);
    expect(listOfIds(out, root)).toEqual(['then-1', 'if-1']);
    expect(listOfIds(out, thenPath)).toEqual(['tail']);
    expect(ids(out)).toEqual(ids(control.scenario));
    expect(scenarioNodeCount(out)).toBe(scenarioNodeCount(control.scenario!));
  });

  it('moves a Condition with its branches into another Condition', () => {
    const nested = moveScenarioStepTo(
      insertScenarioStep(control.scenario!, root, {
        id: 'if-2',
        kind: 'if',
        condition: { kind: 'literal', value: true } as never,
        then: [],
        else: [],
      }),
      root,
      'if-1',
      { ...root, branches: [{ stepId: 'if-2', arm: 'else' }] },
      0,
    );
    expect(listOfIds(nested, root)).toEqual(['tail', 'if-2']);
    expect(listOfIds(nested, { ...root, branches: [{ stepId: 'if-2', arm: 'else' }] })).toEqual([
      'if-1',
    ]);
    const deeper: StepListPath = {
      ...root,
      branches: [
        { stepId: 'if-2', arm: 'else' },
        { stepId: 'if-1', arm: 'else' },
      ],
    };
    expect(listOfIds(nested, deeper)).toEqual(['else-1']);
    expect(ids(nested)).toEqual([...ids(control.scenario), 'if-2'].sort());
  });

  it('refuses to move a Condition into its own branch and leaves the input untouched', () => {
    expect(() => moveScenarioStepTo(control.scenario!, root, 'if-1', elsePath, 0)).toThrow(
      /itself/,
    );
    expect(() => moveScenarioStepTo(control.scenario!, root, 'tail', thenPath, 5)).toThrow(
      /position/,
    );
    expect(listOfIds(control.scenario!, root)).toEqual(['if-1', 'tail']);
  });

  it('shifts a step by keyboard through Then, Else and out, in reading order', () => {
    let scenario = control.scenario!;
    // 'tail' is below if-1: down from above enters; here walk it up into Else, Then, then out.
    scenario = shiftScenarioStep(scenario, root, 'tail', -1)!;
    expect(listOfIds(scenario, elsePath)).toEqual(['else-1', 'tail']);
    scenario = shiftScenarioStep(scenario, elsePath, 'else-1', -1)!;
    expect(listOfIds(scenario, thenPath)).toEqual(['then-1', 'else-1']);
    scenario = shiftScenarioStep(scenario, thenPath, 'then-1', -1)!;
    expect(listOfIds(scenario, root)).toEqual(['then-1', 'if-1']);
    scenario = shiftScenarioStep(scenario, root, 'then-1', 1)!;
    expect(listOfIds(scenario, thenPath)).toEqual(['then-1', 'else-1']);
    scenario = shiftScenarioStep(scenario, thenPath, 'else-1', 1)!;
    expect(listOfIds(scenario, thenPath)).toEqual(['then-1']);
    expect(listOfIds(scenario, elsePath)).toEqual(['else-1', 'tail']);
    expect(shiftScenarioStep(scenario, root, 'if-1', -1)).toBeUndefined();
    expect(ids(scenario)).toEqual(ids(control.scenario));
  });
});

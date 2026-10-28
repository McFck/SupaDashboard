import { expect, it, vi } from 'vitest';
import { VariableStore } from '../automation/variables';
import type { SkinDef } from './contracts';
import { SkinController } from './skin-controller';

it('disposes earlier skin runtimes when a later startup fails and allows a clean retry', () => {
  const variables = new VariableStore();
  const disposed: string[] = [];
  let fail = true;
  const definitions = new Map<string, SkinDef>();
  for (const id of ['first', 'second', 'third']) {
    variables.define(
      {
        id: `${id}.view`,
        name: `${id}.view`,
        type: 'string',
        owner: id,
        persistent: false,
        readOnly: false,
        initialValue: 'default',
      },
      id,
    );
    definitions.set(id, {
      id,
      title: id,
      component: {} as SkinDef['component'],
      slots: [],
      views: [{ id: 'default', title: 'Default', slots: [] }],
      defaultView: 'default',
      runtime: () => {
        if (id === 'third' && fail) {
          throw new Error('Startup failed');
        }
        return () => {
          disposed.push(id);
        };
      },
    });
  }
  const controller = new SkinController({
    definitions,
    variables,
    getSettings: () => ({}),
    isOwner: () => true,
    setVariable: async (id, value, owner) => variables.set(id, value, owner),
    emitEvent: vi.fn(async () => {}),
  });

  expect(() => controller.start()).toThrow('Startup failed');
  expect(disposed).toEqual(['second', 'first']);
  expect(controller.updateConfig('first', { changed: true })).toBe(false);
  controller.dispose();
  expect(disposed).toEqual(['second', 'first']);

  fail = false;
  controller.start();
  controller.dispose();
  expect(disposed).toEqual(['second', 'first', 'third', 'second', 'first']);
});

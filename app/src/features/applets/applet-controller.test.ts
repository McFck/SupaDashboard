import { expect, it, vi } from 'vitest';
import { VariableStore } from '../automation/variables';
import type { AppletDef } from './contracts';
import { AppletController } from './applet-controller';

function setup(owner = true) {
  const variables = new VariableStore();
  const definitions = new Map<string, AppletDef>();
  const log: string[] = [];
  const failed: string[] = [];
  let failStart = '';
  for (const id of ['first', 'second']) {
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
      component: {} as AppletDef['component'],
      slots: [],
      views: [{ id: 'default', title: 'Default', slots: [] }],
      defaultView: 'default',
      start: () => {
        if (id === failStart) {
          throw new Error('Startup failed');
        }
        log.push(`start ${id}`);
        return () => {
          log.push(`stop ${id}`);
        };
      },
    });
  }
  const controller = new AppletController({
    definitions,
    variables,
    getSettings: () => ({}),
    isOwner: () => owner,
    setVariable: async (id, value, appletOwner) => variables.set(id, value, appletOwner),
    emitEvent: vi.fn(async () => {}),
    onStartFailed: (id) => failed.push(id),
  });
  return {
    controller,
    definitions,
    log,
    failed,
    failNext: (id: string) => {
      failStart = id;
    },
  };
}

it('starts an applet once while pages use it and stops it once when the last page leaves', () => {
  const { controller, log } = setup();
  controller.start(['first', undefined]);
  controller.sync(['first', 'first']);
  controller.sync(['first', undefined]);
  expect(log).toEqual(['start first']);
  controller.sync([undefined, undefined]);
  controller.sync([undefined]);
  expect(log).toEqual(['start first', 'stop first']);
  controller.sync(['first']);
  controller.dispose();
  controller.dispose();
  expect(log).toEqual(['start first', 'stop first', 'start first', 'stop first']);
});

it('stops an applet whose plugin is no longer registered and ignores unknown ids', () => {
  const { controller, definitions, log } = setup();
  controller.start(['first', 'missing']);
  definitions.delete('first');
  controller.sync(['first', 'missing']);
  expect(log).toEqual(['start first', 'stop first']);
});

it('never starts in a window that does not own the runtime', () => {
  const { controller, log } = setup(false);
  controller.start(['first']);
  controller.sync(['second']);
  expect(log).toEqual([]);
});

it('keeps other applets running when one fails to start and does not retry it on every edit', () => {
  const { controller, log, failed, failNext } = setup();
  failNext('first');
  controller.start(['first', 'second']);
  controller.sync(['first', 'second']);
  expect(failed).toEqual(['first']);
  expect(log).toEqual(['start second']);
  expect(controller.updateConfig('first', { changed: true })).toBe(false);
  controller.dispose();
  expect(log).toEqual(['start second', 'stop second']);
});

import type { ActionContext, PluginApi, Param } from '../features/plugins/contracts';
import { settings } from '../features/settings/state.svelte';
import { currentRuntime } from '../app/runtime/session.svelte';
import { parseVariableText } from '../features/automation/variables';

const pageParam: Param = {
  key: 'page',
  label: 'Page',
  type: 'select',
  suggestions: () => settings.deck.pages.map((page) => ({ value: page.id, label: page.name })),
};

function pageRuntime(context: ActionContext | undefined) {
  const runtime = currentRuntime();
  if (!context || context.signal.aborted || !runtime?.isOwner) {
    throw new Error('Page navigation runtime is unavailable');
  }
  return runtime;
}

export function registerCoreAutomation(api: PluginApi) {
  const variableParam: Param = {
    key: 'variable',
    label: 'Variable',
    type: 'select',
    searchable: true,
    suggestions: () =>
      api.listVariables().map((record) => ({
        value: record.definition.id,
        label: `${record.definition.name} (${record.definition.type})`,
        plugin: record.definition.owner,
      })),
  };
  const variable = (id: unknown) => {
    const record = api.listVariables().find((entry) => entry.definition.id === id);
    if (!record) {
      throw new Error('Variable is unavailable');
    }
    return record;
  };
  api.registerAction({
    id: 'page.next',
    title: 'Next page',
    run: (_args, context) => {
      const runtime = pageRuntime(context);
      runtime.changePageInDirection('next', 'action', context?.eventAncestry);
    },
  });
  api.registerAction({
    id: 'page.prev',
    title: 'Previous page',
    run: (_args, context) => {
      const runtime = pageRuntime(context);
      runtime.changePageInDirection('prev', 'action', context?.eventAncestry);
    },
  });
  api.registerAction({
    id: 'page.goto',
    title: 'Go to page',
    params: [pageParam],
    run: (args, context) => {
      if (!context || context.signal.aborted) {
        throw new Error('Page navigation runtime is unavailable');
      }
      const pageId = args.page;
      if (typeof pageId !== 'string' || !settings.deck.pages.some((page) => page.id === pageId)) {
        throw new Error('Page is unavailable');
      }
      const runtime = pageRuntime(context);
      runtime.changePage(pageId, 'action', context?.eventAncestry);
    },
  });
  api.registerAction({
    id: 'variable.set',
    title: 'Set variable',
    params: [variableParam, { key: 'value', label: 'Value', type: 'text', default: '' }],
    bindableVariable: (args) => String(args.variable ?? '') || undefined,
    run: async (args, context) => {
      if (!context) {
        throw new Error('Variable runtime is unavailable');
      }
      const record = variable(args.variable);
      await context.setVariable(
        record.definition.id,
        parseVariableText(record.definition.type, String(args.value ?? '')),
      );
    },
  });
  api.registerAction({
    id: 'variable.toggle',
    title: 'Toggle Boolean variable',
    params: [variableParam],
    bindableVariable: (args) => String(args.variable ?? '') || undefined,
    run: async (args, context) => {
      if (!context) {
        throw new Error('Variable runtime is unavailable');
      }
      const record = variable(args.variable);
      if (record.definition.type !== 'boolean') {
        throw new Error('Toggle requires a Boolean variable');
      }
      await context.setVariable(record.definition.id, !record.value);
    },
  });
  api.registerAction({
    id: 'variable.increment',
    title: 'Increment numeric variable',
    params: [variableParam, { key: 'by', label: 'By', type: 'number', default: 1 }],
    bindableVariable: (args) => String(args.variable ?? '') || undefined,
    run: async (args, context) => {
      if (!context) {
        throw new Error('Variable runtime is unavailable');
      }
      const record = variable(args.variable),
        by = Number(args.by ?? 1);
      if (
        (record.definition.type !== 'integer' && record.definition.type !== 'float') ||
        !Number.isFinite(by)
      ) {
        throw new Error('Increment requires a numeric variable and finite value');
      }
      const next = Number(record.value) + by;
      if (record.definition.type === 'integer' && !Number.isSafeInteger(next)) {
        throw new Error('Integer is outside the safe range');
      }
      await context.setVariable(record.definition.id, next);
    },
  });
  api.registerAction({
    id: 'event.emit',
    title: 'Emit event',
    params: [
      { key: 'eventId', label: 'Event ID', type: 'text', default: '' },
      { key: 'parameter', label: 'Parameter', type: 'text', default: '' },
    ],
    run: async (args, context) => {
      if (!context) {
        throw new Error('Event runtime is unavailable');
      }
      const id = String(args.eventId ?? '');
      await context.emitEvent(id, String(args.parameter ?? '') || undefined);
    },
  });
  for (const [id, name, type, initialValue] of [
    ['clock.time', 'clock.time', 'string', ''],
    ['clock.date', 'clock.date', 'string', ''],
    ['clock.day', 'clock.day', 'string', ''],
  ] as const) {
    api.registerVariable({ id, name, type, initialValue, persistent: false, readOnly: true });
  }
}

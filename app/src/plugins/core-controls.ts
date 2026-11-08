import type { ActionContext, PluginApi, Param } from '../features/plugins/contracts';
import { stateIdAt } from '../features/controls/variants';
import { settings } from '../features/settings/state.svelte';

/** The target argument ('self' is the running control) and the Off / On roles of the control it names. */
function rolesOf(args: Record<string, unknown>, context: ActionContext | undefined) {
  if (!context) {
    throw new Error('Button state runtime is unavailable');
  }
  const target = String(args.target ?? 'self');
  const id = target === 'self' ? context.controlId : target;
  return {
    runtime: context,
    target,
    roles: settings.controls.find((control) => control.id === id)?.stateRoles,
  };
}

export function registerCoreControls(api: PluginApi) {
  const controlParam: Param = {
    key: 'target',
    label: 'Control',
    type: 'select',
    default: 'self',
    suggestions: () => [
      { value: 'self', label: 'This control' },
      ...settings.controls.map((control) => ({ value: control.id, label: control.name })),
    ],
  };
  const stateParam: Param = {
    key: 'variant',
    label: 'State',
    type: 'select',
    default: 'next',
    suggestions: (args) => {
      const id = args?.target === 'self' ? undefined : String(args?.target ?? '');
      const control = id ? settings.controls.find((item) => item.id === id) : undefined;
      const selected = control ?? settings.controls.find((item) => item.type === 'button');
      return [
        { value: 'next', label: 'Next' },
        { value: 'prev', label: 'Previous' },
        ...(selected
          ? selected.variants.map((state, i) => ({
              value: stateIdAt(selected, i),
              label: state.label || `State ${i + 1}`,
            }))
          : []),
      ];
    },
  };
  const setStateRole =
    (role: 'off' | 'on') => async (args: Record<string, unknown>, context?: ActionContext) => {
      const { runtime, target, roles } = rolesOf(args, context);
      if (!roles?.[role]) {
        throw new Error(`This control has no ${role} state`);
      }
      await runtime.setVariant(target, roles[role]);
    };
  api.registerAction({
    id: 'button.variant',
    title: 'Change button state',
    params: [controlParam, stateParam],
    run: async (args, context) => {
      if (!context) {
        throw new Error('Button state runtime is unavailable');
      }
      await context.setVariant(String(args.target ?? 'self'), String(args.variant ?? 'next'));
    },
  });
  api.registerAction({
    id: 'button.off',
    title: 'Set button Off',
    params: [controlParam],
    run: setStateRole('off'),
  });
  api.registerAction({
    id: 'button.on',
    title: 'Set button On',
    params: [controlParam],
    run: setStateRole('on'),
  });
  api.registerAction({
    id: 'button.toggle',
    title: 'Toggle button Off / On',
    params: [controlParam],
    run: async (args, context) => {
      const { runtime, target, roles } = rolesOf(args, context);
      if (!roles) {
        throw new Error('This control has no Off / On states');
      }
      await runtime.setVariant(
        target,
        runtime.getVariant(target) === roles.on ? roles.off : roles.on,
      );
    },
  });
}

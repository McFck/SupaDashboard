import type { PluginApi, Param } from '../features/plugins/contracts';
import { stateIdAt } from '../features/controls/variants';
import { settings } from '../features/settings/state.svelte';

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
    (role: 'off' | 'on') =>
    async (
      args: Record<string, unknown>,
      context?: import('../features/plugins/contracts').ActionContext,
    ) => {
      if (!context) {
        throw new Error('Button state runtime is unavailable');
      }
      const target = String(args.target ?? 'self');
      const controlId = target === 'self' ? context.controlId : target;
      const stateId = settings.controls.find((control) => control.id === controlId)?.stateRoles?.[
        role
      ];
      if (!stateId) {
        throw new Error(`This control has no ${role} state`);
      }
      await context.setVariant(target, stateId);
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
      if (!context) {
        throw new Error('Button state runtime is unavailable');
      }
      const target = String(args.target ?? 'self'),
        id = target === 'self' ? context.controlId : target;
      const roles = settings.controls.find((control) => control.id === id)?.stateRoles;
      if (!roles) {
        throw new Error('This control has no Off / On states');
      }
      const current = context.getVariant(target);
      await context.setVariant(target, current === roles.on ? roles.off : roles.on);
    },
  });
}

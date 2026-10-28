import { openUrl } from '@tauri-apps/plugin-opener';
import type { PluginApi, ActionRef } from '../features/plugins/contracts';

export function registerCoreUtilities(api: PluginApi) {
  api.registerAction({
    id: 'open',
    title: 'Open URL or app link',
    params: [{ key: 'url', label: 'URL', type: 'text', default: 'https://' }],
    run: (a) => openUrl(String(a.url)),
  });
  api.registerAction({
    id: 'delay',
    title: 'Wait',
    params: [{ key: 'ms', label: 'Milliseconds', type: 'number', default: 300 }],
    run: (a) => new Promise((r) => setTimeout(r, Number(a.ms ?? 0))),
  });
  // MacroDeck-style custom buttons: chain any registered actions.
  api.registerAction({
    id: 'sequence',
    title: 'Run several actions (macro)',
    params: [{ key: 'steps', label: 'Steps', type: 'actions', default: [] }],
    run: async (a, context) => {
      if (!context) throw new Error('Action sequence runtime is unavailable');
      if (context.signal.aborted) return;
      await context.runSteps(
        ((a.steps as ActionRef[]) ?? []).map((action, index) => ({
          id: `sequence-${index + 1}`,
          kind: 'action',
          action,
        })),
      );
    },
  });
}

export function registerCoreAppIcons(api: PluginApi) {
  for (const [app, icon] of [
    ['discord', 'MessageCircle'],
    ['chrome', 'Chrome'],
    ['msedge', 'Globe'],
    ['firefox', 'Globe'],
    ['steam', 'Gamepad2'],
    ['vlc', 'Clapperboard'],
    ['teams', 'Users'],
    ['zoom', 'Video'],
  ] as const)
    api.registerAppIcon(app, icon);
}

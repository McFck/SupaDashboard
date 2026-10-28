import type { PluginApi } from '../features/plugins/contracts';
import { currentRuntime } from '../app/runtime/session.svelte';
import { contentTargets } from '../features/plugins/content-targets';

export function registerUiContentActions(api: PluginApi) {
  api.registerAction({
    id: 'web.reload',
    title: 'Reload web page',
    params: [
      {
        key: 'target',
        label: 'Target',
        type: 'select',
        default: 'self',
        suggestions: () => contentTargets('web'),
      },
    ],
    run: (args, context) => {
      if (!context || context.signal.aborted) {
        return;
      }
      return currentRuntime()?.contentCommand(
        typeof args.target === 'string' && args.target !== 'self' ? args.target : context.controlId,
        'reload',
      );
    },
  });
}

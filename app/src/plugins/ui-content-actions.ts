import type { PluginApi } from '../features/plugins/contracts';
import { currentRuntime } from '../app/runtime/session.svelte';
import { contentTargets } from '../features/plugins/content-targets';

export function registerUiContentActions(api: PluginApi) {
  for (const [id, title, command] of [
    ['media.nextSlide', 'Next slide', 'next'],
    ['media.prevSlide', 'Previous slide', 'prev'],
  ] as const)
    api.registerAction({
      id,
      title,
      params: [
        {
          key: 'target',
          label: 'Target',
          type: 'select',
          default: 'self',
          suggestions: () => contentTargets('media'),
        },
      ],
      run: (args, context) => {
        if (!context || context.signal.aborted) return;
        return currentRuntime()?.contentCommand(
          typeof args.target === 'string' && args.target !== 'self'
            ? args.target
            : context.controlId,
          command,
        );
      },
    });
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
      if (!context || context.signal.aborted) return;
      return currentRuntime()?.contentCommand(
        typeof args.target === 'string' && args.target !== 'self'
          ? args.target
          : context.controlId,
        'reload',
      );
    },
  });
}

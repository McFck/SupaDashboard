import { invoke } from '@tauri-apps/api/core';
import { settings } from '../features/settings/state.svelte';
import { currentRuntime } from '../app/runtime/session.svelte';
import { mediaSources } from '../features/plugins/registry';
import { contentTargets } from '../features/plugins/content-targets';
import type { PluginApi, Param } from '../features/plugins/contracts';

const sourceParam: Param = {
  key: 'source',
  label: 'Media source',
  type: 'select',
  default: 'system',
  suggestions: () =>
    [...mediaSources.values()].map((s) => ({ value: s.id, label: s.title, plugin: s.plugin })),
};
const mediaControlParam: Param = {
  key: 'target',
  label: 'Media widget',
  type: 'select',
  default: 'self',
  suggestions: () => contentTargets('media'),
};

type Command = 'prev' | 'next' | 'toggle';
const media = (command: Command) => async (a: Record<string, unknown>) => {
  const id = (a.source as string) || 'system';
  const source = mediaSources.get(id);
  if (!source) throw new Error(`Media source "${id}" isn't available (plugin missing?)`);
  return source.command(command);
};
const mediaOrSlide =
  (command: 'prev' | 'next') =>
  async (
    args: Record<string, unknown>,
    context?: import('../features/plugins/contracts').ActionContext,
  ) => {
    if (typeof args.target === 'string') {
      if (!context) throw new Error('Media action context is unavailable');
      if (context.signal.aborted) return;
      const controlId = args.target === 'self' ? context.controlId : args.target;
      const control = settings.controls.find((entry) => entry.id === controlId);
      if (control?.type === 'media') {
        const runtime = currentRuntime();
        if (!runtime?.isOwner) throw new Error('Content runtime is unavailable');
        return runtime.contentCommand(controlId, command);
      }
      if (args.target !== 'self') throw new Error('Media target is unavailable');
    }
    return media(command)(args);
  };

export function registerCoreMedia(api: PluginApi) {
  // Whatever Windows considers the current player (any app using the system media controls).
  api.registerMediaSource({
    id: 'system',
    title: 'System',
    command: (command) => invoke('media_command', { target: 'any', command }),
  });

  api.registerAction({
    id: 'media.prev',
    title: 'Previous track or slide',
    params: [sourceParam, mediaControlParam],
    run: mediaOrSlide('prev'),
  });
  api.registerAction({
    id: 'media.next',
    title: 'Next track or slide',
    params: [sourceParam, mediaControlParam],
    run: mediaOrSlide('next'),
  });
  api.registerAction({
    id: 'media.goto',
    title: 'Go to media slide',
    params: [
      mediaControlParam,
      { key: 'index', label: 'Slide index', type: 'number', default: 0 },
    ],
    run: (args, context) => {
      if (!context || context.signal.aborted) return;
      const target =
        typeof args.target === 'string' && args.target !== 'self'
          ? args.target
          : context.controlId;
      const runtime = currentRuntime();
      if (!runtime?.isOwner) throw new Error('Content runtime is unavailable');
      return runtime.contentCommand(target, 'goto', Number(args.index));
    },
  });
  api.registerAction({
    id: 'media.toggle',
    title: 'Play / pause',
    params: [sourceParam],
    run: media('toggle'),
  });
}

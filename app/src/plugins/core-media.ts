import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { runtimeView } from '../app/runtime/state';
import { nativeAppKey } from '../features/media/now-playing';
import { settings } from '../features/settings/state.svelte';
import { currentRuntime } from '../app/runtime/session.svelte';
import { appOwners, mediaSources } from '../features/plugins/registry';
import { contentTargets } from '../features/plugins/content-targets';
import type { ActionContext, Option, PluginApi, Param } from '../features/plugins/contracts';
import { nativeSessions } from '../platform/media';

const APP_PREFIX = 'app:';
const appName = (key: string) => {
  try {
    return decodeURIComponent(key.slice(APP_PREFIX.length));
  } catch {
    return key;
  }
};

/**
 * Registered sources, then live apps and apps plugins know, each addressed as `app:<app id>`. An app a
 * source already covers (Spotify) keeps its source row; a saved app that is not running stays, unavailable.
 */
function sourceOptions(args?: Record<string, unknown>) {
  const options: Option[] = [...mediaSources.values()].map((s) => ({
    value: s.id,
    label: s.title,
    plugin: s.plugin,
  }));
  const claims = [...mediaSources.keys()].filter((id) => id !== 'system');
  for (const app of get(runtimeView).status.catalogue) {
    if (!claims.some((claim) => appName(app.key).toLowerCase().includes(claim))) {
      options.push({ value: app.key, label: app.title });
    }
  }
  for (const [app, plugin] of appOwners) {
    if (!claims.includes(app)) {
      const value = nativeAppKey(app);
      if (!options.some((option) => option.value === value)) {
        options.push({ value, label: app.charAt(0).toUpperCase() + app.slice(1), plugin });
      }
    }
  }
  const saved = args?.source;
  if (typeof saved === 'string' && saved.startsWith(APP_PREFIX)) {
    if (!options.some((option) => option.value === saved)) {
      options.push({ value: saved, label: appName(saved), unavailable: true });
    }
  }
  return options;
}

const sourceParam: Param = {
  key: 'source',
  label: 'Media source',
  type: 'select',
  default: 'system',
  suggestions: sourceOptions,
};
const mediaControlParam: Param = {
  key: 'target',
  label: 'Media widget',
  type: 'select',
  default: 'self',
  suggestions: () => contentTargets('media'),
};

type Command = 'prev' | 'next' | 'toggle';

/** Native sources answer false when no player took the command; that is a failed action. */
function delivered(result: unknown) {
  if (result === false) {
    throw new Error('No player took the media command');
  }
  return result;
}

const media = (command: Command) => async (a: Record<string, unknown>) => {
  const id = (a.source as string) || 'system';
  if (id.startsWith(APP_PREFIX)) {
    const app = appName(id);
    const result = await invoke('media_command', { target: app, command });
    if (result === false) {
      throw new Error(`${app} isn't playing anything`);
    }
    return result;
  }
  const source = mediaSources.get(id);
  if (!source) {
    throw new Error(`Media source "${id}" isn't available (plugin missing?)`);
  }
  return delivered(await source.command(command));
};

/** Resolved when the step runs: the widget's session now, addressed exactly, never re-matched by app. */
async function nowPlayingCommand(controlId: string, command: 'prev' | 'next') {
  const runtime = currentRuntime();
  if (!runtime?.isOwner) {
    throw new Error('Media runtime is unavailable');
  }
  const target = runtime.nowPlayingTarget(controlId);
  if (!target) {
    throw new Error('Nothing is playing');
  }
  const source = target.sourceId ? mediaSources.get(target.sourceId) : undefined;
  if (!source) {
    throw new Error('This source cannot be controlled');
  }
  return delivered(await source.command(command, target.sessionId));
}
const mediaOrSlide =
  (command: 'prev' | 'next') => async (args: Record<string, unknown>, context?: ActionContext) => {
    if (typeof args.target === 'string') {
      if (!context) {
        throw new Error('Media action context is unavailable');
      }
      if (context.signal.aborted) {
        return;
      }
      const controlId = args.target === 'self' ? context.controlId : args.target;
      const control = settings.controls.find((entry) => entry.id === controlId);
      if (control?.type === 'media') {
        const runtime = currentRuntime();
        if (!runtime?.isOwner) {
          throw new Error('Content runtime is unavailable');
        }
        return runtime.contentCommand(controlId, command);
      }
      if (control?.type === 'nowPlaying') {
        // "system" is the source parameter's default, so only another source is a conflict.
        if (typeof args.source === 'string' && args.source && args.source !== 'system') {
          throw new Error('A now-playing target cannot be combined with another media source');
        }
        return nowPlayingCommand(controlId, command);
      }
      if (args.target !== 'self') {
        throw new Error('Media target is unavailable');
      }
    }
    return media(command)(args);
  };

export function registerCoreMedia(api: PluginApi) {
  // Whatever Windows considers the current player (any app using the system media controls).
  api.registerMediaSource({
    id: 'system',
    title: 'System',
    command: (command, sessionId) => invoke('media_command', { target: 'any', command, sessionId }),
  });
  api.registerStatusSource({
    id: 'system',
    title: 'System',
    kind: 'nowPlaying',
    mediaSourceId: 'system',
    subscribe: nativeSessions(),
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
    params: [mediaControlParam, { key: 'index', label: 'Slide index', type: 'number', default: 0 }],
    run: (args, context) => {
      if (!context || context.signal.aborted) {
        return;
      }
      const target =
        typeof args.target === 'string' && args.target !== 'self' ? args.target : context.controlId;
      const runtime = currentRuntime();
      if (!runtime?.isOwner) {
        throw new Error('Content runtime is unavailable');
      }
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

// Built-in actions, values, media source. A third-party plugin looks exactly like this.
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { get } from 'svelte/store';
import { settings } from '../core/settings.svelte';
import { pageItems } from '../core/pages';
import { hasPlacement } from '../core/skin-layouts';
import { currentRuntime } from '../core/runtime.svelte';
import { appOwners, mediaSources, runAction, type ActionRef, type Param, type Plugin } from '../core/registry';
import { parseVariableText } from '../core/variables';
import { findVolumeChannel, initVolumeSync, readVolume, setMuted, setVolume, volumeChannels } from '../core/volume';

export type { Channel } from '../core/volume';
/** Apps with an audio session right now (process names without .exe). */
let liveApps: string[] = [];
/** Master volume + every app with an audio session. */
const stopVolumeTargets = volumeChannels.subscribe(list => {
  liveApps = list.filter(c => c.target !== 'system').map(c => c.target);
});
if (import.meta.hot) import.meta.hot.dispose(stopVolumeTargets);
export const mixer = async () => {
  await initVolumeSync();
  return get(volumeChannels);
};
/** Targets already used by widgets in any layout, so they stay pickable while that app is closed. */
function usedTargets() {
  const placed = new Set(pageItems(settings.deck.pages, settings.skinLayouts).map(i => i.control));
  const out: unknown[] = [];
  for (const c of settings.controls) {
    if (!placed.has(c.id)) continue;
    const refs: unknown[] = [...c.variants.flatMap(v => [v.value, v.action]), ...Object.values(c.gestures ?? {})];
    const visit = (steps: unknown) => {
      if (!Array.isArray(steps)) return;
      for (const step of steps) {
        if (step && typeof step === 'object' && 'kind' in step) {
          const row = step as { kind?: string; action?: unknown; then?: unknown; else?: unknown };
          if (row.kind === 'action') refs.push(row.action);
          else if (row.kind === 'if') { visit(row.then); visit(row.else); }
        } else refs.push(step);
      }
    };
    for (const list of Object.values(c.scenario?.triggers ?? {})) if (list) {
      visit(list.steps);
      for (const steps of Object.values(list.byState ?? {})) visit(steps);
    }
    for (const listener of c.scenario?.events ?? []) {
      visit(listener.list.steps);
      for (const steps of Object.values(listener.list.byState ?? {})) visit(steps);
    }
    // Only volume refs name an audio app; other actions use `target` for controls (e.g. 'self').
    for (const ref of refs) {
      const r = ref as { id?: string; args?: Record<string, unknown> } | null;
      if (r && typeof r === 'object' && (r.id === 'volume' || r.id?.startsWith('volume.'))) out.push(r.args?.target);
    }
    const channels = c.options?.channels;
    if (Array.isArray(channels)) for (const ch of channels) out.push(ch?.target);
  }
  return out.filter((t): t is string => typeof t === 'string' && t !== '' && t !== 'system');
}
const title = (a: string) => a[0].toUpperCase() + a.slice(1);
const sourceParam: Param = { key: 'source', label: 'Media source', type: 'select', default: 'system',
  suggestions: () => [...mediaSources.values()].map(s => ({ value: s.id, label: s.title, plugin: s.plugin })) };
const mediaControlParam: Param = { key: 'target', label: 'Media widget', type: 'select', default: 'self',
  suggestions: () => [{ value: 'self', label: 'This widget' }, ...settings.controls.filter(control => control.type === 'media' &&
    hasPlacement(settings, control.id)).map(control => ({ value: control.id, label: control.name }))] };
const targetParam: Param = { key: 'target', label: 'Volume of', type: 'select', default: 'system',
  suggestions: () => [{ value: 'system', label: 'System' },
    ...[...new Set([...liveApps, ...usedTargets()])].sort().map(a => ({ value: a, label: title(a), plugin: appOwners.get(a.toLowerCase()) }))],
  refresh: mixer };
const pageParam: Param = { key: 'page', label: 'Page', type: 'select',
  suggestions: () => settings.deck.pages.map(page => ({ value: page.id, label: page.name })) };

type Command = 'prev' | 'next' | 'toggle';
const media = (command: Command) => async (a: Record<string, unknown>) => {
  const id = (a.source as string) || 'system';
  const source = mediaSources.get(id);
  if (!source) throw new Error(`Media source "${id}" isn't available (plugin missing?)`);
  return source.command(command);
};
const mediaOrSlide = (command: 'prev' | 'next') => async (args: Record<string, unknown>, context?: import('../core/registry').ActionContext) => {
  if (typeof args.target === 'string') {
    if (!context) throw new Error('Media action context is unavailable');
    if (context.signal.aborted) return;
    const controlId = args.target === 'self' ? context.controlId : args.target;
    const control = settings.controls.find(entry => entry.id === controlId);
    if (control?.type === 'media') {
      const runtime = currentRuntime();
      if (!runtime?.isOwner) throw new Error('Content runtime is unavailable');
      return runtime.contentCommand(controlId, command);
    }
    if (args.target !== 'self') throw new Error('Media target is unavailable');
  }
  return media(command)(args);
};

export const corePlugin: Plugin = {
  id: 'core',
  title: 'Core',
  builtin: true,
  setup(api) {
    const controlParam: Param = { key: 'target', label: 'Control', type: 'select', default: 'self',
      suggestions: () => [{ value: 'self', label: 'This control' }, ...settings.controls.map(control => ({ value: control.id, label: control.name }))] };
    const stateParam: Param = { key: 'variant', label: 'State', type: 'select', default: 'next',
      suggestions: args => {
        const id = args?.target === 'self' ? undefined : String(args?.target ?? '');
        const control = id ? settings.controls.find(item => item.id === id) : undefined;
        const selected = control ?? settings.controls.find(item => item.type === 'button');
        return [{ value: 'next', label: 'Next' }, { value: 'prev', label: 'Previous' },
          ...(selected?.variants ?? []).map((state, i) => ({ value: state.id ?? `state-${i + 1}`, label: state.label || `State ${i + 1}` }))];
      } };
    const variableParam: Param = { key: 'variable', label: 'Variable', type: 'select',
      suggestions: () => api.listVariables().map(record => ({ value: record.definition.id,
        label: `${record.definition.name} (${record.definition.type})`, plugin: record.definition.owner })) };
    const variable = (id: unknown) => {
      const record = api.listVariables().find(entry => entry.definition.id === id);
      if (!record) throw new Error('Variable is unavailable');
      return record;
    };
    const setStateRole = (role: 'off' | 'on') => async (args: Record<string, unknown>, context?: import('../core/registry').ActionContext) => {
      if (!context) throw new Error('Button state runtime is unavailable');
      const target = String(args.target ?? 'self');
      const controlId = target === 'self' ? context.controlId : target;
      const stateId = settings.controls.find(control => control.id === controlId)?.stateRoles?.[role];
      if (!stateId) throw new Error(`This control has no ${role} state`);
      await context.setVariant(target, stateId);
    };
    // Whatever Windows considers the current player (any app using the system media controls).
    api.registerMediaSource({ id: 'system', title: 'System',
      command: command => invoke('media_command', { target: 'any', command }) });

    api.registerAction({ id: 'media.prev', title: 'Previous track or slide', params: [sourceParam, mediaControlParam], run: mediaOrSlide('prev') });
    api.registerAction({ id: 'media.next', title: 'Next track or slide', params: [sourceParam, mediaControlParam], run: mediaOrSlide('next') });
    api.registerAction({ id: 'media.goto', title: 'Go to media slide', params: [mediaControlParam,
      { key: 'index', label: 'Slide index', type: 'number', default: 0 }],
      run: (args, context) => {
        if (!context || context.signal.aborted) return;
        const target = typeof args.target === 'string' && args.target !== 'self' ? args.target : context.controlId;
        const runtime = currentRuntime();
        if (!runtime?.isOwner) throw new Error('Content runtime is unavailable');
        return runtime.contentCommand(target, 'goto', Number(args.index));
      } });
    api.registerAction({ id: 'media.toggle', title: 'Play / pause', params: [sourceParam], run: media('toggle') });
    api.registerAction({ id: 'button.variant', title: 'Change button state', params: [controlParam, stateParam],
      run: async (args, context) => {
        if (!context) throw new Error('Button state runtime is unavailable');
        await context.setVariant(String(args.target ?? 'self'), String(args.variant ?? 'next'));
      } });
    api.registerAction({ id: 'button.off', title: 'Set button Off', params: [controlParam], run: setStateRole('off') });
    api.registerAction({ id: 'button.on', title: 'Set button On', params: [controlParam], run: setStateRole('on') });
    api.registerAction({ id: 'button.toggle', title: 'Toggle button Off / On', params: [controlParam], run: async (args, context) => {
      if (!context) throw new Error('Button state runtime is unavailable');
      const target = String(args.target ?? 'self'), id = target === 'self' ? context.controlId : target;
      const roles = settings.controls.find(control => control.id === id)?.stateRoles;
      if (!roles) throw new Error('This control has no Off / On states');
      const current = context.getVariant(target);
      await context.setVariant(target, current === roles.on ? roles.off : roles.on);
    } });
    api.registerAction({ id: 'page.next', title: 'Next page', run: (_args, context) => {
      if (!context || context.signal.aborted) throw new Error('Page navigation runtime is unavailable');
      const runtime = currentRuntime();
      if (!runtime?.isOwner) throw new Error('Page navigation runtime is unavailable');
      runtime.changePageInDirection('next', 'action', context.eventAncestry);
    } });
    api.registerAction({ id: 'page.prev', title: 'Previous page', run: (_args, context) => {
      if (!context || context.signal.aborted) throw new Error('Page navigation runtime is unavailable');
      const runtime = currentRuntime();
      if (!runtime?.isOwner) throw new Error('Page navigation runtime is unavailable');
      runtime.changePageInDirection('prev', 'action', context.eventAncestry);
    } });
    api.registerAction({ id: 'page.goto', title: 'Go to page', params: [pageParam], run: (args, context) => {
      if (!context || context.signal.aborted) throw new Error('Page navigation runtime is unavailable');
      const pageId = args.page;
      if (typeof pageId !== 'string' || !settings.deck.pages.some(page => page.id === pageId)) throw new Error('Page is unavailable');
      const runtime = currentRuntime();
      if (!runtime?.isOwner) throw new Error('Page navigation runtime is unavailable');
      runtime.changePage(pageId, 'action', context.eventAncestry);
    } });
    api.registerAction({ id: 'variable.set', title: 'Set variable', params: [variableParam,
      { key: 'value', label: 'Value', type: 'text', default: '' }],
      bindableVariable: args => String(args.variable ?? '') || undefined,
      run: async (args, context) => {
        if (!context) throw new Error('Variable runtime is unavailable');
        const record = variable(args.variable);
        await context.setVariable(record.definition.id, parseVariableText(record.definition.type, String(args.value ?? '')));
      } });
    api.registerAction({ id: 'variable.toggle', title: 'Toggle Boolean variable', params: [variableParam],
      bindableVariable: args => String(args.variable ?? '') || undefined,
      run: async (args, context) => {
        if (!context) throw new Error('Variable runtime is unavailable');
        const record = variable(args.variable);
        if (record.definition.type !== 'boolean') throw new Error('Toggle requires a Boolean variable');
        await context.setVariable(record.definition.id, !record.value);
      } });
    api.registerAction({ id: 'variable.increment', title: 'Increment numeric variable', params: [variableParam,
      { key: 'by', label: 'By', type: 'number', default: 1 }],
      bindableVariable: args => String(args.variable ?? '') || undefined,
      run: async (args, context) => {
        if (!context) throw new Error('Variable runtime is unavailable');
        const record = variable(args.variable), by = Number(args.by ?? 1);
        if ((record.definition.type !== 'integer' && record.definition.type !== 'float') || !Number.isFinite(by))
          throw new Error('Increment requires a numeric variable and finite value');
        const next = Number(record.value) + by;
        if (record.definition.type === 'integer' && !Number.isSafeInteger(next)) throw new Error('Integer is outside the safe range');
        await context.setVariable(record.definition.id, next);
      } });
    api.registerAction({ id: 'event.emit', title: 'Emit event', params: [
      { key: 'eventId', label: 'Event ID', type: 'text', default: '' },
      { key: 'parameter', label: 'Parameter', type: 'text', default: '' }],
      run: async (args, context) => {
        if (!context) throw new Error('Event runtime is unavailable');
        const id = String(args.eventId ?? '');
        await context.emitEvent(id, String(args.parameter ?? '') || undefined);
      } });
    for (const [id, name, type, initialValue] of [
      ['clock.time', 'clock.time', 'string', ''], ['clock.date', 'clock.date', 'string', ''], ['clock.day', 'clock.day', 'string', ''],
    ] as const) api.registerVariable({ id, name, type, initialValue, persistent: false, readOnly: true });
    api.registerAction({
      id: 'volume.step', title: 'Change volume by a step',
      params: [targetParam, { key: 'by', label: 'Step (-1 to 1)', type: 'number', default: 0.05 }],
      run: async a => {
        const t = (a.target as string) || 'system';
        const now = await readVolume(t);
        if (now != null) await setVolume(t, now + Number(a.by ?? 0.05));
      },
    });
    api.registerAction({
      id: 'volume.mute', title: 'Mute / unmute', params: [targetParam],
      run: async a => {
        const t = (a.target as string) || 'system';
        const channel = findVolumeChannel(await mixer(), t);
        if (channel) await setMuted(t, !channel.muted);
      },
    });
    api.registerAction({ id: 'open', title: 'Open URL or app link',
      params: [{ key: 'url', label: 'URL', type: 'text', default: 'https://' }], run: a => openUrl(String(a.url)) });
    api.registerAction({ id: 'delay', title: 'Wait', params: [{ key: 'ms', label: 'Milliseconds', type: 'number', default: 300 }],
      run: a => new Promise(r => setTimeout(r, Number(a.ms ?? 0))) });
    // MacroDeck-style custom buttons: chain any registered actions.
    api.registerAction({
      id: 'sequence', title: 'Run several actions (macro)',
      params: [{ key: 'steps', label: 'Steps', type: 'actions', default: [] }],
      run: async a => { for (const step of (a.steps as ActionRef[]) ?? []) await runAction(step); },
    });

    // target: "system" or a process name such as "discord".
    api.registerValue({
      id: 'volume', title: 'Volume', params: [targetParam],
      get: a => readVolume((a.target as string) || 'system'),
      set: (a, v) => setVolume((a.target as string) || 'system', Number(v)),
    });

    for (const [app, icon] of [['discord', 'MessageCircle'], ['chrome', 'Chrome'], ['msedge', 'Globe'], ['firefox', 'Globe'],
      ['steam', 'Gamepad2'], ['vlc', 'Clapperboard'], ['teams', 'Users'], ['zoom', 'Video']] as const)
      api.registerAppIcon(app, icon);
  },
};

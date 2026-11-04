// Host registry: the registered extension points, plugin installation and persistence.
import { get, writable } from 'svelte/store';
import { load } from '@tauri-apps/plugin-store';
import type {
  ActionContext,
  ActionDef,
  ActionRef,
  ControlTypeDef,
  EventAncestry,
  EventDef,
  MediaSource,
  Param,
  Plugin,
  PluginApi,
  PluginVariableDef,
  StatusSourceDef,
  ValueDef,
  ValueRef,
} from './contracts';
import { controlById, settings } from '../settings/state.svelte';
import type { VariableRecord, VariableStore } from '../automation/variables';
import { TRIGGERS, type Trigger } from '../automation/scenario';
import { normalizePluginState, type PluginState } from './plugin-store';
import { validateAppletDefinition, withQuickActionSettings } from '../applets/definition';
import { type AppletDef as AppletDefinition } from '../applets/contracts';

export const actions = new Map<string, ActionDef>();
export const values = new Map<string, ValueDef>();
export const controlTypes = new Map<string, ControlTypeDef>();
/** Triggers a control type offers and runs; saved lists for any other trigger stay inert. */
export const controlTriggers = (type: string): readonly Trigger[] =>
  controlTypes.get(type)?.triggers ?? TRIGGERS;
/** False for a saved list of a trigger its control's type does not offer: it never runs. */
export function runsTrigger({
  controlId,
  trigger,
}: {
  controlId: string;
  trigger: Trigger | 'event';
}) {
  const type = controlById(controlId)?.type;
  return trigger === 'event' || !type || controlTriggers(type).includes(trigger);
}
export const applets = new Map<string, AppletDefinition>();
export const mediaSources = new Map<string, MediaSource>();
export const statusSources = new Map<string, StatusSourceDef>();
export const customIcons = new Map<string, string>();
export const appIcons = new Map<string, string>();
/** Which plugin registered each app, so app pickers can show the plugin mark. */
export const appOwners = new Map<string, string>();
export const plugins: Plugin[] = [];
export const bundledPlugins: Plugin[] = [];
export const pluginState = writable<PluginState>(normalizePluginState(null));
const variableDefinitions = new Map<string, { owner: string; definition: PluginVariableDef }>();
const eventDefinitions = new Map<string, EventDef>();
const appletVariableIds = new Map<string, string>();
export function registeredEvents(
  variables: readonly VariableRecord[] = variableMirror ?? [],
): EventDef[] {
  const core: EventDef = {
    id: 'variables.changed',
    title: 'Variable changed',
    parameterSuggestions: () =>
      variables.map((record) => ({
        value: record.definition.id,
        label: record.definition.name,
        unavailable: record.definition.available === false,
        plugin: record.definition.owner,
      })),
  };
  const pageChanged: EventDef = {
    id: 'page.changed',
    title: 'Page changed',
    parameterSuggestions: () =>
      settings.deck.pages.map((page) => ({
        value: page.id,
        label: page.name,
      })),
  };
  return [
    core,
    pageChanged,
    ...[...eventDefinitions.values()].filter(
      (event) => event.id !== core.id && event.id !== pageChanged.id,
    ),
  ].map(copyEvent);
}
export type RegistryRuntime = {
  variables: VariableStore;
  registerEvent(definition: EventDef): void;
  emitEvent(
    id: string,
    parameter?: string,
    payload?: unknown,
    ancestry?: EventAncestry,
  ): Promise<void>;
};
let registryRuntime: RegistryRuntime | undefined;
let variableMirror: VariableRecord[] | undefined;

export function setVariableMirror(records: readonly VariableRecord[] | undefined) {
  variableMirror = records ? records.map((record) => structuredClone(record)) : undefined;
}

function copyEvent(event: EventDef): EventDef {
  return {
    ...event,
    ...(Array.isArray(event.parameterSuggestions)
      ? { parameterSuggestions: structuredClone(event.parameterSuggestions) }
      : {}),
  };
}

function defineVariable(owner: string, definition: PluginVariableDef) {
  const entry = { owner, definition: structuredClone(definition) };
  variableDefinitions.set(definition.id, entry);
  registryRuntime?.variables.define({ ...entry.definition, owner }, owner);
}

function namesOf(definition: PluginVariableDef) {
  return [definition.name, ...(definition.aliases ?? [])];
}

function registerApplet(owner: string, d: AppletDefinition) {
  validateAppletDefinition(d);
  const stateVariables: PluginVariableDef[] = [
    {
      id: `${d.id}.view`,
      name: `${d.title} view`,
      type: 'string',
      initialValue: d.defaultView,
      persistent: false,
      readOnly: true,
    },
    ...(d.state ?? []).map((field) => ({
      id: `${d.id}.${field.key}`,
      name: `${d.title} ${field.key}`,
      type: field.type,
      initialValue: field.initialValue,
      persistent: field.persistent ?? false,
      readOnly: true,
    })),
  ];
  const names = new Set<string>();
  const incomingIds = new Set(stateVariables.map((definition) => definition.id));
  const existingRecords = registryRuntime
    ? Object.values(registryRuntime.variables.snapshot().records)
    : [];
  const occupiedNames = [
    ...[...variableDefinitions.entries()]
      .filter(([id]) => !incomingIds.has(id))
      .flatMap(([, entry]) => namesOf(entry.definition)),
    ...existingRecords
      .filter((record) => !incomingIds.has(record.definition.id))
      .flatMap((record) => namesOf(record.definition)),
  ].map((name) => name.trim().toLocaleLowerCase());
  for (const definition of stateVariables) {
    const id = definition.id;
    const current = variableDefinitions.get(id);
    if (current && (current.owner !== owner || appletVariableIds.get(id) !== d.id)) {
      throw new Error(`Applet variable "${id}" is already registered`);
    }
    const runtimeRecord = registryRuntime?.variables.get(id);
    if (runtimeRecord && runtimeRecord.definition.owner !== owner) {
      throw new Error(`Applet variable "${id}" belongs to another plugin`);
    }
    const name = definition.name.trim().toLocaleLowerCase();
    if (names.has(name) || occupiedNames.includes(name))
      throw new Error(`Applet variable name "${definition.name}" is already in use`);
    names.add(name);
  }
  for (const event of d.events ?? []) {
    const current = eventDefinitions.get(event.id);
    if (current && current.plugin !== owner)
      throw new Error(`Applet event "${event.id}" belongs to another plugin`);
  }
  const existing = applets.get(d.id);
  if (existing && existing.plugin !== owner)
    throw new Error(`Applet "${d.id}" belongs to another plugin`);
  for (const definition of stateVariables) {
    defineVariable(owner, definition);
    appletVariableIds.set(definition.id, d.id);
  }
  for (const definition of d.events ?? []) {
    const event = copyEvent({ ...definition, plugin: owner });
    eventDefinitions.set(event.id, event);
    registryRuntime?.registerEvent(event);
  }
  applets.set(d.id, { ...withQuickActionSettings(d), plugin: owner });
}

/** `app:` and `known-app:` are filter keys the host builds for applications. */
function registerStatusSource(owner: string, d: StatusSourceDef) {
  if (
    typeof d.id !== 'string' ||
    !d.id ||
    d.id.length > 128 ||
    d.id.startsWith('app:') ||
    d.id.startsWith('known-app:')
  ) {
    throw new Error(`Status source id "${String(d.id)}" is not allowed`);
  }
  if (d.kind !== 'nowPlaying' || typeof d.title !== 'string' || typeof d.subscribe !== 'function') {
    throw new Error(`Status source "${d.id}" is malformed`);
  }
  const existing = statusSources.get(d.id);
  if (existing && existing.plugin !== owner) {
    throw new Error(`Status source "${d.id}" belongs to another plugin`);
  }
  if (d.mediaSourceId !== undefined && mediaSources.get(d.mediaSourceId)?.plugin !== owner) {
    throw new Error(`Status source "${d.id}" links to a media source of another plugin`);
  }
  statusSources.set(d.id, { ...d, plugin: owner });
}

function createApi(owner: string): PluginApi {
  return {
    registerAction: (d) => void actions.set(d.id, { ...d, plugin: owner }),
    registerValue: (d) => void values.set(d.id, { ...d, plugin: owner }),
    registerControl: (d) => void controlTypes.set(d.type, { ...d, plugin: owner }),
    registerApplet: (d) => registerApplet(owner, d),
    registerMediaSource: (d) => void mediaSources.set(d.id, { ...d, plugin: owner }),
    registerStatusSource: (d) => registerStatusSource(owner, d),
    registerVariable: (definition) => defineVariable(owner, definition),
    listVariables: () =>
      registryRuntime
        ? Object.values(registryRuntime.variables.snapshot().records).map((record) =>
            structuredClone(record),
          )
        : variableMirror
          ? variableMirror.map((record) => structuredClone(record))
          : [...variableDefinitions.values()].map((entry) => ({
              definition: {
                ...structuredClone(entry.definition),
                owner: entry.owner,
                available: true,
              },
              value: structuredClone(entry.definition.initialValue),
            })),
    setVariable: async (id, value) => {
      if (!registryRuntime) throw new Error('Variable runtime is unavailable');
      return registryRuntime.variables.set(id, value, owner);
    },
    registerIcon: (name, path) => void customIcons.set(name, path),
    registerAppIcon: (app, icon) => {
      appIcons.set(app.toLowerCase(), icon);
      appOwners.set(app.toLowerCase(), owner);
    },
  };
}

/** Attach the main runtime after plugin/settings setup; declarations stay inert in the panel webview. */
export function setRegistryRuntime(runtime: RegistryRuntime) {
  registryRuntime = runtime;
  for (const entry of variableDefinitions.values()) defineVariable(entry.owner, entry.definition);
  for (const event of eventDefinitions.values()) runtime.registerEvent(event);
  return () => {
    if (registryRuntime === runtime) registryRuntime = undefined;
  };
}

export function install(...list: Plugin[]) {
  for (const p of list) {
    if (plugins.some((x) => x.id === p.id)) continue;
    p.setup(createApi(p.id));
    plugins.push(p);
  }
}

export const actionsByPlugin = () =>
  plugins
    .map((plugin) => ({
      plugin,
      actions: [...actions.values()].filter((action) => action.plugin === plugin.id),
    }))
    .filter((group) => group.actions.length);

let pluginStore: Awaited<ReturnType<typeof load>> | undefined;
let lastPluginState = '';
const browserPluginKey = 'plugin-store';

async function persistPlugins(state: PluginState) {
  lastPluginState = JSON.stringify(state);
  if (pluginStore) {
    await pluginStore.set('plugin-store', state);
    await pluginStore.save();
  } else localStorage.setItem(browserPluginKey, lastPluginState);
  pluginState.set(state);
}

/** Load the separate plugin store before registering bundled plugins in either window. */
export async function installEnabled(...list: Plugin[]) {
  bundledPlugins.splice(0, bundledPlugins.length, ...list);
  let saved: unknown;
  try {
    pluginStore = await load('plugins.json', { defaults: {}, autoSave: false });
    saved = await pluginStore.get('plugin-store');
  } catch {
    try {
      saved = JSON.parse(localStorage.getItem(browserPluginKey) ?? 'null');
    } catch {
      saved = null;
    }
  }
  const state = normalizePluginState(saved);
  for (const plugin of list)
    if (!state.installed[plugin.id]) state.installed[plugin.id] = new Date().toISOString();
  await persistPlugins(state);
  install(
    ...list.filter(
      (plugin) => plugin.builtin || plugin.default || !state.uninstalled.includes(plugin.id),
    ),
  );
  if (pluginStore)
    await pluginStore.onKeyChange('plugin-store', (raw) => {
      if (JSON.stringify(normalizePluginState(raw)) !== lastPluginState) {
        // Reload both windows so bundled registrations are applied consistently.
        setTimeout(() => location.reload(), 250);
      }
    });
  else
    window.addEventListener('storage', (event) => {
      if (event.key === browserPluginKey) location.reload();
    });
}

export async function setPluginEnabled(id: string, enabled: boolean) {
  const plugin = bundledPlugins.find((p) => p.id === id);
  if (!plugin || (!enabled && (plugin.builtin || plugin.default))) return;
  const state = structuredClone(get(pluginState));
  state.uninstalled = state.uninstalled.filter((entry) => entry !== id);
  if (!enabled) state.uninstalled.push(id);
  state.installed[id] ??= new Date().toISOString();
  await persistPlugins(state);
  location.reload();
}

export const suggestionsOf = (p: Param, args?: Record<string, unknown>) =>
  typeof p.suggestions === 'function' ? p.suggestions(args) : p.suggestions;

export async function runAction(ref: ActionRef, context?: ActionContext) {
  const def = actions.get(ref.id);
  if (!def) throw new Error(`Unknown action "${ref.id}"`);
  return def.run(ref.args ?? {}, context);
}

export function value(ref: ValueRef) {
  const def = values.get(ref.id);
  if (!def) throw new Error(`Unknown value "${ref.id}"`);
  return {
    get: () => def.get(ref.args ?? {}),
    set: (v: number) => def.set(ref.args ?? {}, v),
  };
}

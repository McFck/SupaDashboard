// Extension points. Built-in features register through exactly the same API as plugins.
import type { Component } from 'svelte';
import type { ControlConfig } from './controls';
import type { ActionStep, Trigger } from './scenario';
import { VariableStore, type VariableDefinition, type VariableRecord, type VariableValue } from './variables';
import { get, writable } from 'svelte/store';
import { load } from '@tauri-apps/plugin-store';
import { normalizePluginState, type PluginState } from './plugin-store';

/** A reference to an action plus its arguments, as stored in settings. */
export type ActionRef = { id: string; args?: Record<string, unknown> };

export type Option = { value: string; label: string; plugin?: string };
export type EventAncestry = { depth: number; listeners: string[] };

export type ActionContext = {
  signal: AbortSignal;
  runId: string;
  controlId: string;
  itemId: string;
  trigger: Trigger | 'event';
  listenerId?: string;
  sourceStateId: string;
  event?: { id: string; parameter?: string; payload?: unknown };
  eventAncestry?: EventAncestry;
  getVariable(id: string): VariableValue | undefined;
  setVariable(id: string, value: VariableValue, ancestry?: EventAncestry): Promise<boolean>;
  getVariant(controlId: string): string | undefined;
  setVariant(controlId: string, stateId: string): Promise<void> | void;
  emitEvent(id: string, parameter?: string, payload?: unknown, ancestry?: EventAncestry): Promise<void>;
  runSteps(steps: ActionStep[]): Promise<void>;
};

export type EventDef = { plugin?: string; id: string; title: string; parameterSuggestions?: Option[] | (() => Option[]) };
export type PluginVariableDef = Omit<VariableDefinition, 'owner' | 'available'>;
export type VariableChange = { id: string; oldValue: VariableValue | undefined; value: VariableValue; type: VariableDefinition['type'] };

/** Describes one argument so the editor can render a form for any action, including plugin ones. */
export type Param = {
  key: string;
  label: string;
  /** 'select' = dropdown of `suggestions` only; 'text' = free text with suggestions. */
  type: 'text' | 'number' | 'select' | 'actions';
  /** Offered values. A function is re-read each time the editor opens. */
  suggestions?: Option[] | ((args?: Record<string, unknown>) => Option[]);
  /** Reloads whatever `suggestions` reads; called when the dropdown opens. */
  refresh?: (args?: Record<string, unknown>) => Promise<unknown>;
  default?: unknown;
};

export type ActionDef = {
  plugin?: string;
  id: string;
  title: string;
  params?: Param[];
  bindableVariable?(args: Record<string, unknown>): string | undefined;
  run(args: Record<string, unknown>, context?: ActionContext): unknown | Promise<unknown>;
};

/** Something a slider can read and write (system volume, an app's volume, brightness...). */
export type ValueRef = { id: string; args?: Record<string, unknown> };
export type ValueDef = {
  plugin?: string;
  id: string;
  title: string;
  params?: Param[];
  /** 0..1, or null when unavailable (e.g. the app isn't running). */
  get(args: Record<string, unknown>): Promise<number | null>;
  set(args: Record<string, unknown>, value: number): Promise<unknown>;
};

/** A widget type. Sizes are in deck cells. */
export type ControlTypeDef = {
  plugin?: string;
  type: string;
  title: string;
  icon: string;
  component: Component<any>;
  size: { w: number; h: number };
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  /** Starting configuration when added from the palette. */
  create(): Omit<ControlConfig, 'id' | 'type'>;
};

/** Where media commands go: Windows' current player, or a specific app supplied by a plugin. */
export type MediaSource = {
  plugin?: string;
  id: string;
  title: string;
  command(command: 'prev' | 'next' | 'toggle' | 'play' | 'pause'): Promise<unknown>;
};

export type SkinDef = { plugin?: string; id: string; title: string; component: Component };

export type PluginApi = {
  registerAction(def: ActionDef): void;
  registerValue(def: ValueDef): void;
  registerControl(def: ControlTypeDef): void;
  registerSkin(def: SkinDef): void;
  registerMediaSource(def: MediaSource): void;
  registerVariable(def: PluginVariableDef): void;
  getVariable(id: string): VariableValue | undefined;
  listVariables(): VariableRecord[];
  setVariable(id: string, value: VariableValue): Promise<boolean>;
  subscribeVariable(id: string, listener: (change: VariableChange) => void): () => void;
  registerEvent(def: Omit<EventDef, 'plugin'>): void;
  emitEvent(id: string, parameter?: string, payload?: unknown): Promise<void>;
  /** A custom icon (24×24 SVG path, drawn as an outline) usable anywhere icons are chosen. */
  registerIcon(name: string, path: string): void;
  /** Icon shown for an app in the volume mixer, keyed by process name ("spotify"). */
  registerAppIcon(app: string, icon: string): void;
};

export type Plugin = {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  author?: string;
  version?: string;
  updated?: string;
  size?: number | string;
  default?: boolean;
  source?: string;
  settings?: Component;
  /** Part of the app itself: not listed on the Plugins page. */
  builtin?: boolean;
  setup(api: PluginApi): void;
};

export const actions = new Map<string, ActionDef>();
export const values = new Map<string, ValueDef>();
export const controlTypes = new Map<string, ControlTypeDef>();
export const skins = new Map<string, SkinDef>();
export const mediaSources = new Map<string, MediaSource>();
export const customIcons = new Map<string, string>();
export const customIconOwners = new Map<string, string>();
export const appIcons = new Map<string, string>();
/** Which plugin registered each app, so app pickers can show the plugin mark. */
export const appOwners = new Map<string, string>();
export const plugins: Plugin[] = [];
export const bundledPlugins: Plugin[] = [];
export const pluginState = writable<PluginState>(normalizePluginState(null));
const variableDefinitions = new Map<string, { owner: string; definition: PluginVariableDef }>();
const eventDefinitions = new Map<string, EventDef>();
export function registeredEvents(variables: readonly VariableRecord[] = variableMirror ?? []): EventDef[] {
  const core: EventDef = { id: 'variables.changed', title: 'Variable changed', parameterSuggestions: () => variables.map(record => ({
    value: record.definition.id,
    label: `${record.definition.available === false ? 'Unavailable · ' : ''}${record.definition.name}`,
    plugin: record.definition.owner,
  })) };
  return [core, ...[...eventDefinitions.values()].filter(event => event.id !== core.id)].map(event => ({ ...event,
    ...(Array.isArray(event.parameterSuggestions) ? { parameterSuggestions: structuredClone(event.parameterSuggestions) } : {}) }));
}
export type RegistryRuntime = {
  variables: VariableStore;
  registerEvent(definition: EventDef): void;
  emitEvent(id: string, parameter?: string, payload?: unknown, ancestry?: EventAncestry): Promise<void>;
};
let registryRuntime: RegistryRuntime | undefined;
let variableMirror: VariableRecord[] | undefined;

export function setVariableMirror(records: readonly VariableRecord[] | undefined) {
  variableMirror = records ? records.map(record => structuredClone(record)) : undefined;
}

function createApi(owner: string): PluginApi {
  return {
    registerAction: d => void actions.set(d.id, { ...d, plugin: owner }),
    registerValue: d => void values.set(d.id, { ...d, plugin: owner }),
    registerControl: d => void controlTypes.set(d.type, { ...d, plugin: owner }),
    registerSkin: d => void skins.set(d.id, { ...d, plugin: owner }),
    registerMediaSource: d => void mediaSources.set(d.id, { ...d, plugin: owner }),
    registerVariable: definition => {
      const entry = { owner, definition: structuredClone(definition) };
      variableDefinitions.set(definition.id, entry);
      if (registryRuntime) registryRuntime.variables.define({ ...entry.definition, owner }, owner);
    },
    getVariable: id => registryRuntime?.variables.getValue(id) ?? variableMirror?.find(record => record.definition.id === id)?.value,
    listVariables: () => registryRuntime ? Object.values(registryRuntime.variables.snapshot().records)
      .map(record => structuredClone(record)) : variableMirror ? variableMirror.map(record => structuredClone(record)) : [...variableDefinitions.values()].map(entry => ({
        definition: { ...structuredClone(entry.definition), owner: entry.owner, available: true },
        value: structuredClone(entry.definition.initialValue),
      })),
    setVariable: async (id, value) => {
      if (!registryRuntime) throw new Error('Variable runtime is unavailable');
      return registryRuntime.variables.set(id, value, owner);
    },
    subscribeVariable: (id, listener) => {
      if (!registryRuntime) return () => {};
      let previous = registryRuntime.variables.getValue(id);
      return registryRuntime.variables.subscribe(snapshot => {
        const record = snapshot.records[id];
        if (!record || record.value === previous) return;
        const oldValue = previous;
        previous = record.value;
        listener({ id, oldValue, value: record.value, type: record.definition.type });
      });
    },
    registerEvent: definition => {
      const event = { ...structuredClone(definition), plugin: owner };
      eventDefinitions.set(event.id, event);
      registryRuntime?.registerEvent(event);
    },
    emitEvent: (id, parameter, payload) => {
      if (!registryRuntime) throw new Error('Event runtime is unavailable');
      return registryRuntime.emitEvent(id, parameter, payload);
    },
    registerIcon: (name, path) => { customIcons.set(name, path); customIconOwners.set(name, owner); },
    registerAppIcon: (app, icon) => { appIcons.set(app.toLowerCase(), icon); appOwners.set(app.toLowerCase(), owner); },
  };
}

/** Attach the main runtime after plugin/settings setup; declarations stay inert in the panel webview. */
export function setRegistryRuntime(runtime: RegistryRuntime) {
  registryRuntime = runtime;
  for (const entry of variableDefinitions.values()) runtime.variables.define({ ...entry.definition, owner: entry.owner }, entry.owner);
  for (const event of eventDefinitions.values()) runtime.registerEvent(event);
  return () => { if (registryRuntime === runtime) registryRuntime = undefined; };
}

export function install(...list: Plugin[]) {
  for (const p of list) {
    if (plugins.some(x => x.id === p.id)) continue;
    plugins.push(p);
    p.setup(createApi(p.id));
  }
}

export const actionsByPlugin = () => plugins.map(plugin => ({ plugin,
  actions: [...actions.values()].filter(action => action.plugin === plugin.id),
})).filter(group => group.actions.length);

let pluginStore: Awaited<ReturnType<typeof load>> | undefined;
let lastPluginState = '';
const browserPluginKey = 'plugin-store';

async function persistPlugins(state: PluginState) {
  lastPluginState = JSON.stringify(state);
  if (pluginStore) { await pluginStore.set('plugin-store', state); await pluginStore.save(); }
  else localStorage.setItem(browserPluginKey, lastPluginState);
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
    try { saved = JSON.parse(localStorage.getItem(browserPluginKey) ?? 'null'); } catch { saved = null; }
  }
  const state = normalizePluginState(saved);
  for (const plugin of list) if (!state.installed[plugin.id]) state.installed[plugin.id] = new Date().toISOString();
  await persistPlugins(state);
  install(...list.filter(plugin => plugin.builtin || plugin.default || !state.uninstalled.includes(plugin.id)));
  if (pluginStore) await pluginStore.onKeyChange('plugin-store', raw => {
    if (JSON.stringify(normalizePluginState(raw)) !== lastPluginState) {
      // Reload both windows so bundled registrations are applied consistently.
      setTimeout(() => location.reload(), 250);
    }
  });
  else window.addEventListener('storage', event => { if (event.key === browserPluginKey) location.reload(); });
}

export async function setPluginEnabled(id: string, enabled: boolean) {
  const plugin = bundledPlugins.find(p => p.id === id);
  if (!plugin || (!enabled && (plugin.builtin || plugin.default))) return;
  const state = structuredClone(get(pluginState));
  state.uninstalled = state.uninstalled.filter(entry => entry !== id);
  if (!enabled) state.uninstalled.push(id);
  state.installed[id] ??= new Date().toISOString();
  await persistPlugins(state);
  location.reload();
}

export async function setCatalogUrl(url: string) {
  const next = url.trim();
  if (next && !['https:', 'http:'].includes(new URL(next).protocol)) throw new Error('Use an HTTP or HTTPS URL');
  await persistPlugins({ ...get(pluginState), catalogUrl: next });
}

export const suggestionsOf = (p: Param, args?: Record<string, unknown>) =>
  (typeof p.suggestions === 'function' ? p.suggestions(args) : p.suggestions);

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

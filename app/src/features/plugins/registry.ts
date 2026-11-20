// Host registry: extension points and the lifetime of each registered plugin.
import { SvelteMap } from 'svelte/reactivity';
import type {
  ActionContext,
  ActionDef,
  ActionRef,
  ControlTypeDef,
  EventDef,
  MediaSource,
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
import { inPluginSetup } from './setup-scope';
import { validateAppletDefinition, withQuickActionSettings } from '../applets/definition';
import { type AppletDef as AppletDefinition } from '../applets/contracts';

export const actions = new SvelteMap<string, ActionDef>();
export const values = new SvelteMap<string, ValueDef>();
export const controlTypes = new SvelteMap<string, ControlTypeDef>();
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
export const applets = new SvelteMap<string, AppletDefinition>();
export const mediaSources = new SvelteMap<string, MediaSource>();
export const statusSources = new SvelteMap<string, StatusSourceDef>();
export const customIcons = new SvelteMap<string, string>();
export const appIcons = new SvelteMap<string, string>();
/** Which plugin registered each app, so app pickers can show the plugin mark. */
export const appOwners = new SvelteMap<string, string>();
export const plugins = new SvelteMap<string, Plugin>();
const iconOwners = new Map<string, string>();
const instances = new Map<string, { abort: AbortController; cleanups: Set<() => void> }>();
const variableDefinitions = new Map<string, { owner: string; definition: PluginVariableDef }>();
const eventDefinitions = new SvelteMap<string, EventDef>();
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
  unregisterEvent(id: string): void;
  registrationsChanged(): void;
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
  if (
    variableDefinitions.has(definition.id) &&
    variableDefinitions.get(definition.id)?.owner !== owner
  ) {
    throw new Error(`Variable "${definition.id}" belongs to another plugin`);
  }
  const entry = { owner, definition: structuredClone(definition) };
  registryRuntime?.variables.define({ ...entry.definition, owner }, owner);
  variableDefinitions.set(definition.id, entry);
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
    if (event.id === 'page.changed' || event.id === 'variables.changed') {
      throw new Error(`Applet event "${event.id}" belongs to the host`);
    }
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

const triggerListeners = new Set<(trigger: Trigger) => void>();

export function notifyTrigger(trigger: Trigger) {
  for (const listener of triggerListeners) {
    listener(trigger);
  }
}

function createApi(owner: string, signal: AbortSignal, cleanups: Set<() => void>): PluginApi {
  const active = () => !signal.aborted;
  function register<D extends { plugin?: string }>(map: Map<string, D>, id: string, definition: D) {
    if (!active()) {
      return;
    }
    if (map.has(id) && map.get(id)?.plugin !== owner) {
      throw new Error(`Registration "${id}" belongs to another plugin`);
    }
    map.set(id, { ...definition, plugin: owner });
  }
  function icon(map: Map<string, string>, owners: Map<string, string>, key: string, path: string) {
    if (active() && (!owners.has(key) || owners.get(key) === owner)) {
      owners.set(key, owner);
      map.set(key, path);
    }
  }
  return {
    registerAction: (d) => register(actions, d.id, d),
    registerValue: (d) => register(values, d.id, d),
    registerControl: (d) => register(controlTypes, d.type, d),
    registerApplet: (d) => {
      if (active()) {
        registerApplet(owner, d);
      }
    },
    registerMediaSource: (d) => register(mediaSources, d.id, d),
    registerStatusSource: (d) => {
      if (active()) {
        registerStatusSource(owner, d);
      }
    },
    registerVariable: (d) => {
      if (active()) {
        defineVariable(owner, d);
      }
    },
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
      if (!active() || !registryRuntime) throw new Error('Variable runtime is unavailable');
      return registryRuntime.variables.set(id, value, owner);
    },
    runAction: (id, args = {}) => {
      // Best effort: the target plugin may be uninstalled, and its failure must not break the caller.
      if (active()) {
        void runAction({ id, args }).catch(() => {});
      }
    },
    onTrigger: (listener) => {
      const receive = (trigger: Trigger) => listener(trigger);
      const stop = () => {
        triggerListeners.delete(receive);
        cleanups.delete(stop);
      };
      if (active()) {
        triggerListeners.add(receive);
        cleanups.add(stop);
      }
      return stop;
    },
    registerIcon: (name, path) => icon(customIcons, iconOwners, name, path),
    registerAppIcon: (app, path) => icon(appIcons, appOwners, app.toLowerCase(), path),
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
    if (instances.has(p.id)) {
      continue;
    }
    const abort = new AbortController();
    const cleanups = new Set<() => void>();
    instances.set(p.id, { abort, cleanups });
    try {
      inPluginSetup(cleanups, () => {
        const cleanup = p.setup(createApi(p.id, abort.signal, cleanups));
        if (typeof cleanup === 'function') {
          cleanups.add(cleanup);
        }
      });
      plugins.set(p.id, p);
      registryRuntime?.registrationsChanged();
    } catch (error) {
      unregister(p.id);
      throw error;
    }
  }
}

export function unregister(owner: string) {
  const instance = instances.get(owner);
  if (!instance) {
    return;
  }
  instances.delete(owner);
  instance.abort.abort();
  plugins.delete(owner);
  for (const entries of [actions, values, controlTypes, applets, mediaSources, statusSources]) {
    for (const [id, entry] of entries) {
      if (entry.plugin === owner) {
        entries.delete(id);
      }
    }
  }
  for (const [owners, icons] of [
    [iconOwners, customIcons],
    [appOwners, appIcons],
  ]) {
    for (const [name, plugin] of owners) {
      if (plugin === owner) {
        owners.delete(name);
        icons.delete(name);
      }
    }
  }
  for (const [id, event] of eventDefinitions) {
    if (event.plugin === owner) {
      eventDefinitions.delete(id);
      registryRuntime?.unregisterEvent(id);
    }
  }
  registryRuntime?.registrationsChanged();
  for (const cleanup of [...instance.cleanups].reverse()) {
    try {
      cleanup();
    } catch (error) {
      console.warn(`Could not stop plugin ${owner}`, error);
    }
  }
  for (const [id, entry] of variableDefinitions) {
    if (entry.owner === owner) {
      variableDefinitions.delete(id);
      appletVariableIds.delete(id);
      registryRuntime?.variables.undefine(id, owner);
    }
  }
}

export const actionsByPlugin = () =>
  [...plugins.values()]
    .map((plugin) => ({
      plugin,
      actions: [...actions.values()].filter((action) => action.plugin === plugin.id),
    }))
    .filter((group) => group.actions.length);

/** Installs each plugin on its own: one whose setup throws is skipped and cannot stop the rest. */
export function installEach(list: Plugin[]) {
  for (const plugin of list) {
    try {
      install(plugin);
    } catch (error) {
      console.warn(`Plugin ${plugin.id}`, error);
    }
  }
}

export async function runAction(ref: ActionRef, context?: ActionContext) {
  const def = actions.get(ref.id);
  if (!def) throw new Error(`Unknown action "${ref.id}"`);
  const lifetime = def.plugin && instances.get(def.plugin)?.abort.signal;
  const actionContext =
    context && lifetime
      ? { ...context, signal: AbortSignal.any([context.signal, lifetime]) }
      : context;
  return def.run(ref.args ?? {}, actionContext);
}

export function value(ref: ValueRef) {
  const def = values.get(ref.id);
  if (!def) throw new Error(`Unknown value "${ref.id}"`);
  return {
    get: () => def.get(ref.args ?? {}),
    set: (v: number) => def.set(ref.args ?? {}, v),
  };
}

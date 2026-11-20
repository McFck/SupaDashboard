import { isTauri } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { writable } from 'svelte/store';
import { PLUGIN_API } from '../../plugin-kit';
import {
  enablePlugin,
  listPlugins,
  onPluginsChanged,
  uninstallPlugin,
} from '../../platform/plugin-host';
import { isRecord } from '../automation/plain-data';
import type { Plugin } from './contracts';
import { listedPlugins, loadPlugin, type NativePlugin } from './external/load';
import { normalizePluginState } from './plugin-store';
import { install, installEach, plugins, unregister } from './registry';

export const compiledPlugins = new Set<string>();
export const nativePlugins = new SvelteMap<string, NativePlugin>();
export const pluginState = writable(normalizePluginState(null));
export const pluginTrust = (id: string): NativePlugin['trust'] =>
  nativePlugins.get(id)?.trust ?? (compiledPlugins.has(id) ? 'verified' : 'unverified');

type PluginInfo = Pick<Plugin, 'id' | 'title' | 'description' | 'icon'>;
const metadata = new SvelteMap<string, PluginInfo>();
const loaded = new Map<string, { revision: number; dispose(): void }>();
let stopListening: (() => void) | undefined;
let stopped = false;
let queue: Promise<void> = Promise.resolve();

export function pluginInfo(id: string): Omit<Plugin, 'setup'> | undefined {
  return plugins.get(id) ?? metadata.get(id);
}

function unload(id: string) {
  unregister(id);
  loaded.get(id)?.dispose();
  loaded.delete(id);
}

async function reconcile() {
  if (stopped || !isTauri()) {
    return;
  }
  const inventory = await listPlugins();
  if (stopped) {
    return;
  }
  if (!isRecord(inventory)) {
    throw new Error('Invalid plugin inventory');
  }
  const listed = new Map(listedPlugins(inventory.plugins).map((entry) => [entry.id, entry]));
  const wanted = [...listed.values()].filter(
    (entry) =>
      entry.enabled && !entry.consent && entry.api === PLUGIN_API && !compiledPlugins.has(entry.id),
  );
  const revisions = new Map(wanted.map((entry) => [entry.id, entry.revision]));
  let removed = false;
  for (const [id, instance] of loaded) {
    if (revisions.get(id) !== instance.revision) {
      unload(id);
      removed = true;
    }
  }
  for (const id of nativePlugins.keys()) {
    if (!listed.has(id)) {
      nativePlugins.delete(id);
      metadata.delete(id);
    }
  }
  for (const [id, entry] of listed) {
    nativePlugins.set(id, entry);
    metadata.set(id, metadata.get(id) ?? { id, title: id });
  }
  pluginState.set(normalizePluginState(inventory.state));
  if (removed) {
    // Let Svelte destroy mounted widgets and editors before the replacement registers anything.
    await tick();
  }
  for (const entry of wanted) {
    if (stopped || loaded.has(entry.id)) {
      continue;
    }
    try {
      const { plugin, dispose } = await loadPlugin(entry);
      if (stopped) {
        dispose();
        return;
      }
      try {
        install(plugin);
      } catch (error) {
        dispose();
        throw error;
      }
      loaded.set(entry.id, { revision: entry.revision, dispose });
      const { id, title, description, icon } = plugin;
      metadata.set(id, { id, title, description, icon });
    } catch (error) {
      console.warn(`Plugin ${entry.id}`, error);
      toast.error(`Could not load ${entry.id}`);
    }
  }
}

export function refreshPlugins() {
  const next = queue.then(reconcile);
  queue = next.catch((error) => {
    console.warn('Plugin inventory', error);
    toast.error('Could not refresh plugins');
  });
  return next;
}

export async function startPlugins(compiled: Plugin[]) {
  for (const plugin of compiled) {
    compiledPlugins.add(plugin.id);
  }
  installEach(compiled);
  if (isTauri()) {
    const stop = await onPluginsChanged(() => {
      void refreshPlugins().catch(() => {});
    });
    if (stopped) {
      stop();
      return;
    }
    stopListening = stop;
    await refreshPlugins();
  }
}

export function stopPlugins() {
  stopped = true;
  stopListening?.();
  for (const id of plugins.keys()) {
    unload(id);
  }
}

export async function setPluginEnabled(id: string, enabled: boolean) {
  await enablePlugin(id, enabled);
  await refreshPlugins();
}

export async function removePlugin(id: string) {
  await uninstallPlugin(id);
  await refreshPlugins();
}

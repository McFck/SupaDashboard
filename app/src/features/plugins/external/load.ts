// External plugins: UI bundles in `<app data>/plugins/<id>.sdplugin`, served by the native `plugin` scheme. The build
// preset (`plugin-tools/vite-plugin.mjs`) compiles their shared imports to this module table, so they run on the
// app's own Svelte instance. An import map cannot do that: under Vite dev it resolves to a second Svelte instance,
// and a release bundle has no module URL for `svelte/internal/client` at all.
import * as svelte from 'svelte';
// @ts-expect-error Svelte ships no types for the runtime that compiled components call.
import * as client from 'svelte/internal/client';
import * as easing from 'svelte/easing';
import * as motion from 'svelte/motion';
import * as reactivity from 'svelte/reactivity';
import * as store from 'svelte/store';
import * as transition from 'svelte/transition';
import { isTauri } from '@tauri-apps/api/core';
import * as kit from '../../../plugin-kit';
import { listPlugins } from '../../../platform/plugin-host';
import { isRecord } from '../../automation/plain-data';
import type { Plugin } from '../contracts';
import { pluginPermissions, type PluginPermissions } from '../permissions';
import { PLUGIN_ID } from '../plugin-store';

declare global {
  /** Shared modules by import name; `plugin` is where a loading bundle leaves its export. */
  var __supadashboard: Record<string, unknown>;
}

const ORIGIN = 'http://plugin.localhost';

/** An installed `.sdplugin`: `size` in bytes, `updated` in Unix milliseconds. */
export interface NativePlugin {
  id: string;
  version: string;
  api: number;
  trust: 'verified' | 'unverified' | 'dev';
  permissions: PluginPermissions;
  size: number;
  updated: number;
}

/** `plugin_list` entries, by file id. */
export function listedPlugins(raw: unknown): NativePlugin[] {
  if (!Array.isArray(raw)) {
    throw new Error('Invalid plugin list');
  }
  return raw
    .filter(
      (entry): entry is Omit<NativePlugin, 'permissions'> & { permissions: unknown } =>
        isRecord(entry) &&
        typeof entry.id === 'string' &&
        PLUGIN_ID.test(entry.id) &&
        typeof entry.version === 'string' &&
        Number.isSafeInteger(entry.api) &&
        (entry.trust === 'verified' || entry.trust === 'unverified' || entry.trust === 'dev') &&
        Number.isSafeInteger(entry.size) &&
        Number.isSafeInteger(entry.updated),
    )
    .flatMap((entry) => {
      const permissions = pluginPermissions(entry.permissions);
      return permissions ? [{ ...entry, permissions }] : [];
    });
}

/** What a bundle left in the module table, checked against the folder it was loaded from. */
export function pluginExport(id: string, value: unknown): Plugin {
  if (
    !isRecord(value) ||
    value.id !== id ||
    typeof value.title !== 'string' ||
    typeof value.setup !== 'function'
  ) {
    throw new Error(`Plugin ${id} has no valid export`);
  }
  return value as Plugin;
}

function attach(element: HTMLElement) {
  return new Promise<void>((resolve, reject) => {
    element.addEventListener('load', () => resolve(), { once: true });
    element.addEventListener('error', () => reject(new Error('Could not load plugin UI')), {
      once: true,
    });
    document.head.append(element);
  });
}

async function loadPlugin(id: string) {
  const base = `${ORIGIN}/${id}/ui/index`;
  const style = Object.assign(document.createElement('link'), {
    rel: 'stylesheet',
    href: `${base}.css`,
  });
  const script = Object.assign(document.createElement('script'), { src: `${base}.js` });
  try {
    await attach(style);
    await attach(script);
    return pluginExport(id, globalThis.__supadashboard.plugin);
  } catch (error) {
    style.remove();
    throw error;
  } finally {
    script.remove();
    delete globalThis.__supadashboard.plugin;
  }
}

/**
 * Loads one bundle at a time, since each leaves its export in the same slot; a failing plugin is skipped.
 * `listed` is everything native discovered, including plugins for another plugin API.
 */
export async function loadExternalPlugins(): Promise<{
  listed: NativePlugin[];
  plugins: Plugin[];
}> {
  if (!isTauri()) {
    return { listed: [], plugins: [] };
  }
  globalThis.__supadashboard = {
    svelte,
    'svelte/internal/client': client,
    'svelte/easing': easing,
    'svelte/motion': motion,
    'svelte/reactivity': reactivity,
    'svelte/store': store,
    'svelte/transition': transition,
    '@supadashboard/kit': kit,
  };
  const loaded: Plugin[] = [];
  const listed = listedPlugins(await listPlugins());
  for (const { id, api } of listed) {
    if (api !== kit.PLUGIN_API) {
      console.warn(`Plugin ${id} needs plugin API ${api}`);
      continue;
    }
    try {
      loaded.push(await loadPlugin(id));
    } catch (error) {
      console.warn(`Plugin ${id}`, error);
    }
  }
  return { listed, plugins: loaded };
}

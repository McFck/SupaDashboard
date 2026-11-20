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
import * as kit from '../../../plugin-kit';
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
  consent?: { permissions: PluginPermissions; added: Record<string, unknown> };
  size: number;
  updated: number;
  revision: number;
  enabled: boolean;
}

/** `plugin_list` entries, by file id. */
export function listedPlugins(raw: unknown): NativePlugin[] {
  if (!Array.isArray(raw)) {
    throw new Error('Invalid plugin list');
  }
  return raw
    .filter(
      (
        entry,
      ): entry is Omit<NativePlugin, 'permissions' | 'consent'> & {
        permissions: unknown;
        newPermissions?: unknown;
      } =>
        isRecord(entry) &&
        typeof entry.id === 'string' &&
        PLUGIN_ID.test(entry.id) &&
        typeof entry.version === 'string' &&
        Number.isSafeInteger(entry.api) &&
        (entry.trust === 'verified' || entry.trust === 'unverified' || entry.trust === 'dev') &&
        Number.isSafeInteger(entry.size) &&
        Number.isSafeInteger(entry.updated) &&
        typeof entry.revision === 'number' &&
        Number.isSafeInteger(entry.revision) &&
        entry.revision > 0 &&
        typeof entry.enabled === 'boolean',
    )
    .flatMap(({ newPermissions, ...entry }): NativePlugin[] => {
      const permissions = pluginPermissions(entry.permissions);
      if (!permissions) {
        return [];
      }
      if (newPermissions === undefined) {
        return [{ ...entry, permissions }];
      }
      if (!isRecord(newPermissions)) {
        return [];
      }
      const added = pluginPermissions(newPermissions);
      return added
        ? [{ ...entry, permissions, consent: { permissions: added, added: newPermissions } }]
        : [];
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

/** Bundles load serially because they leave their export in one shared slot. */
export async function loadPlugin({ id, revision }: NativePlugin) {
  globalThis.__supadashboard ??= {
    svelte,
    'svelte/internal/client': client,
    'svelte/easing': easing,
    'svelte/motion': motion,
    'svelte/reactivity': reactivity,
    'svelte/store': store,
    'svelte/transition': transition,
    '@supadashboard/kit': kit,
  };
  const base = `${ORIGIN}/${id}/ui/index`;
  const style = Object.assign(document.createElement('link'), {
    rel: 'stylesheet',
    href: `${base}.css?revision=${revision}`,
  });
  const script = Object.assign(document.createElement('script'), {
    src: `${base}.js?revision=${revision}`,
  });
  try {
    await attach(style);
    await attach(script);
    return {
      plugin: pluginExport(id, globalThis.__supadashboard.plugin),
      dispose: () => style.remove(),
    };
  } catch (error) {
    style.remove();
    throw error;
  } finally {
    script.remove();
    delete globalThis.__supadashboard.plugin;
  }
}

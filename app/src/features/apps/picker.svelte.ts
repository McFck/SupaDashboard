// The app selector shared by app actions and every place that refers to an app.
import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { commit } from '../layout/history.svelte';
import type { Option, Param } from '../plugins/contracts';
import { settings } from '../settings/state.svelte';
import { listApps, loadAppIcon, type AppRow } from '../../platform/apps';
import { appLabel, isAppKey, usedApps } from './keys';

/** Process names of apps that have an icon in the `brand-*` pack. */
const BRAND_ICONS: Record<string, string> = {
  battlenet: 'battle-net',
  brave: 'brave',
  chrome: 'chrome',
  code: 'vscode',
  discord: 'discord',
  epicgameslauncher: 'epic-games',
  explorer: 'file-explorer',
  figma: 'figma',
  firefox: 'firefox',
  githubdesktop: 'github',
  msedge: 'edge',
  notion: 'notion',
  obs64: 'obs',
  slack: 'slack',
  steam: 'steam',
  teams: 'teams',
  telegram: 'telegram',
  twitch: 'twitch',
  vlc: 'vlc',
  whatsapp: 'whatsapp',
  windowsterminal: 'terminal',
  zoom: 'zoom',
};

const known = $state<{ rows: AppRow[]; resolved: string[] }>({ rows: [], resolved: [] });
const requested = new Set<string>();
const images = $state<Record<string, string | undefined>>({});
const imageRequests = new Map<string, Promise<void>>();

export const appImage = (key: string) => images[key];

export function requestAppIcon(key: string): Promise<void> {
  if (!isTauri() || !isAppKey(key)) {
    return Promise.resolve();
  }
  const cached = imageRequests.get(key);
  if (cached) {
    return cached;
  }
  const request = (async () => {
    // Listing resolves saved/manual keys too, before the icon command accepts them.
    if (!known.rows.some((row) => row.key === key)) {
      await listApps([key]);
    }
    images[key] = await loadAppIcon(key);
  })().catch(() => {
    // Icon lookup is optional; a removed app keeps its brand or neutral fallback.
  });
  imageRequests.set(key, request);
  return request;
}
let refreshing: Promise<void> | undefined;

export function refreshApps(): Promise<void> {
  if (!isTauri()) {
    known.resolved = [...requested, ...manualKeys()];
    return Promise.resolve();
  }
  // Share in-flight work and retain resolved names/icons when an app leaves the live list.
  return (refreshing ??= listApps([...requested, ...manualKeys()])
    .then((rows) => {
      const keys = new Set(rows.map((row) => row.key));
      known.rows = [...rows, ...known.rows.filter((row) => !keys.has(row.key))];
      known.resolved = [...requested, ...manualKeys()];
    })
    .finally(() => {
      refreshing = undefined;
    }));
}

/** The variable name part of an app: the picker's own answer, else the file name of an `exe:` key. */
export function appSlug(key: string): string | undefined {
  const row = known.rows.find((item) => item.key === key);
  if (row) {
    return row.slug;
  }
  return key.startsWith('exe:')
    ? appLabel(key)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
    : undefined;
}

function manualKeys() {
  return [...new Set([...settings.apps, ...usedApps(settings.controls)])];
}

/** Whether the picker offers this exact key, as opposed to text still being typed. */
export const isOfferedApp = (key: string) =>
  known.rows.some((row) => row.key === key) || manualKeys().includes(key);

/** The app a `app.<slug>.<state>` variable belongs to, among the apps the picker knows. */
export function appKeyForSlug(slug: string): string | undefined {
  const keys = [...manualKeys(), ...known.rows.map((row) => row.key)];
  return keys.find((key) => appSlug(key) === slug);
}

/** The key of the app whose name was typed out in full, so "steam" finishes like picking the row. */
export function appKeyForName(text: string): string | undefined {
  const name = text.trim().toLowerCase();
  return name ? known.rows.find((row) => row.label.toLowerCase() === name)?.key : undefined;
}

/** Adds an app to the watched list, so its state variables exist while something refers to it. */
export function rememberApp(key: string) {
  if (isAppKey(key) && !settings.apps.includes(key)) {
    settings.apps.push(key);
    commit('Add app');
  }
}

/** Known apps show their brand icon, every other app one neutral icon, so labels share a left edge. */
export function appIcon(key: string) {
  const brand = BRAND_ICONS[appSlug(key) ?? ''];
  return brand ? `brand-${brand}` : 'AppWindow';
}

/** The readable name of an app key, never the internal id. */
export const appName = (key: string) =>
  known.rows.find((row) => row.key === key)?.label ?? appLabel(key);

export function appOption(key: string): Option {
  requested.add(key);
  const resolved = known.rows.some((row) => row.key === key);
  const loading = !resolved && !known.resolved.includes(key);
  return {
    value: key,
    label: loading ? '' : appName(key),
    iconName: appIcon(key),
    appKey: key,
    loading,
  };
}

/** Running apps, then the Start menu, then apps used by actions or added by hand. */
function appOptions(): Option[] {
  const options: Option[] = known.rows.map((row) => ({
    value: row.key,
    label: row.label,
    detail: row.key.startsWith('exe:') ? row.detail.split(/[\\/]/).pop() : undefined,
    iconName: appIcon(row.key),
    appKey: row.key,
  }));
  const listed = new Set(known.rows.map((row) => row.key));
  for (const key of manualKeys()) {
    if (!listed.has(key)) {
      listed.add(key);
      options.push(appOption(key));
    }
  }
  return options;
}

export const appManual: NonNullable<Param['manual']> = {
  browse: async () => {
    const path = await open({ filters: [{ name: 'App', extensions: ['exe'] }] });
    if (typeof path !== 'string') {
      return null;
    }
    rememberApp(`exe:${path}`);
    return `exe:${path}`;
  },
  keep: (value) => {
    if (isAppKey(value) && !known.rows.some((row) => row.key === value)) {
      rememberApp(value);
    }
  },
};

export const appParam: Param = {
  key: 'app',
  label: 'App',
  type: 'text',
  default: '',
  suggestions: appOptions,
  describe: (key) => (isAppKey(key) ? appOption(key) : undefined),
  refresh: refreshApps,
  manual: appManual,
};

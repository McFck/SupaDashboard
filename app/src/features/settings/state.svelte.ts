// User settings: one reactive object per window, persisted with tauri-plugin-store and kept in sync between
// the dashboard and the control panel (both windows load the same store and listen for its changes).
import { load } from '@tauri-apps/plugin-store';
import { isTauri } from '@tauri-apps/api/core';
import { migrate } from './migrate';
import { DEFAULT_PAGE, DEFAULTS, type Settings } from './schema';

/** Serialize the live settings with a stable launch placeholder, never the runtime page selection. */
export function serializeSettings(source: Settings = $state.snapshot(settings)) {
  const snapshot = structuredClone(source);
  snapshot.deck.activePage = snapshot.deck.pages[0]?.id ?? DEFAULT_PAGE.id;
  return JSON.stringify(snapshot);
}

export const settings: Settings = $state(structuredClone(DEFAULTS));
const remoteSettingsListeners = new Set<(next: Settings) => void>();

export function onRemoteSettings(listener: (next: Settings) => void) {
  remoteSettingsListeners.add(listener);
  return () => remoteSettingsListeners.delete(listener);
}

export async function loadSettings() {
  const browser = !isTauri();
  const browserKey = 'supadashboard:settings:v5';
  const legacyBrowserKeys = ['supadashboard:settings:v6', 'supadashboard:settings:v4'];
  let last = '';
  const assign = (next: Settings, activePage = next.deck.pages[0].id) => {
    next.deck.activePage = activePage;
    Object.assign(settings, next);
  };
  const applyInitial = (raw: unknown, rawJson?: string) => {
    if ((raw as any)?.version > 6) return false;
    const next = migrate(raw);
    assign(next);
    last = rawJson ?? '';
    return true;
  };
  const applyRemote = (raw: unknown) => {
    if ((raw as any)?.version > 6) return;
    const next = migrate(raw);
    const json = serializeSettings(next);
    if (json === last) return;
    for (const listener of remoteSettingsListeners) listener(next);
    assign(next, settings.deck.activePage);
    last = json;
  };

  if (browser) {
    const rawJson =
      localStorage.getItem(browserKey) ??
      legacyBrowserKeys.map((key) => localStorage.getItem(key)).find(Boolean);
    let raw: unknown = null;
    if (rawJson) {
      try {
        raw = JSON.parse(rawJson);
      } catch {
        raw = null;
      }
    }
    if (!applyInitial(raw, rawJson ?? undefined)) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== browserKey || !event.newValue) return;
      try {
        applyRemote(JSON.parse(event.newValue));
      } catch {
        /* unsupported or partial remote data is ignored */
      }
    };
    window.addEventListener('storage', onStorage);
    $effect.root(() => {
      $effect(() => {
        const json = serializeSettings($state.snapshot(settings));
        if (json !== last) {
          last = json;
          localStorage.setItem(browserKey, json);
        }
      });
    });
    return;
  }
  const store = await load('settings.json', { defaults: {}, autoSave: 200 });
  const raw = await store.get('settings');
  if (!applyInitial(raw, raw ? JSON.stringify(raw) : undefined)) return;
  // Another window (dashboard <-> control panel) changed something: take it over.
  await store.onKeyChange('settings', (value) => {
    if (!value) return;
    try {
      applyRemote(value);
    } catch {
      /* unsupported or partial remote data is ignored */
    }
  });
  $effect.root(() => {
    $effect(() => {
      const json = serializeSettings($state.snapshot(settings));
      if (json !== last) {
        last = json;
        void store.set('settings', JSON.parse(json));
      }
    });
  });
}

export const controlById = (id: string) => settings.controls.find((c) => c.id === id);

export const newId = (prefix: string, taken: string[]) => {
  const base =
    prefix
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'item';
  let id = base,
    n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
};

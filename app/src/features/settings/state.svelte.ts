// User settings: one reactive object per window, persisted with tauri-plugin-store and kept in sync between
// the dashboard and the control panel (both windows load the same store and listen for its changes).
import { load } from '@tauri-apps/plugin-store';
import { isTauri } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { storeIsReadable } from '$lib/store';
import { migrate } from './migrate';
import { SettingsPersistence } from './persistence';
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
  let persistence: SettingsPersistence;
  let initial = '';
  let writingJson: string | undefined;
  // Never write over saved settings this window could not read.
  let blocked = false;
  const loadFailed = () => {
    blocked = true;
    toast.error('Could not load saved settings');
  };
  const save = () => {
    if (blocked) {
      return;
    }
    void persistence.save(serializeSettings($state.snapshot(settings))).catch(() => {
      toast.error('Could not save settings', {
        id: 'settings-save',
        action: { label: 'Retry', onClick: save },
      });
    });
  };
  const assign = (next: Settings, activePage = next.deck.pages[0].id) => {
    next.deck.activePage = activePage;
    Object.assign(settings, next);
  };
  const applyInitial = (raw: unknown, rawJson?: string) => {
    try {
      if (rawJson !== undefined && raw == null) {
        throw new Error('Saved settings are empty');
      }
      assign(migrate(raw));
      initial = rawJson ?? '';
      return true;
    } catch {
      loadFailed();
      return false;
    }
  };
  const applyRemote = (raw: unknown) => {
    const next = migrate(raw);
    const json = serializeSettings(next);
    blocked = false;
    // plugin-store also emits our own set before the disk save completes.
    if (
      json === writingJson ||
      json === persistence.saved ||
      json === serializeSettings($state.snapshot(settings))
    ) {
      return;
    }
    for (const listener of remoteSettingsListeners) listener(next);
    assign(next, settings.deck.activePage);
    persistence.saved = json;
  };

  if (browser) {
    const rawJson =
      localStorage.getItem(browserKey) ??
      legacyBrowserKeys.map((key) => localStorage.getItem(key)).find((value) => value !== null);
    let raw: unknown = null;
    if (rawJson != null) {
      try {
        raw = JSON.parse(rawJson);
      } catch {
        loadFailed();
        return;
      }
    }
    if (!applyInitial(raw, rawJson ?? undefined)) return;
    persistence = new SettingsPersistence(async (json) => {
      localStorage.setItem(browserKey, json);
    }, initial);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== browserKey || !event.newValue) return;
      try {
        applyRemote(JSON.parse(event.newValue));
      } catch {
        loadFailed();
      }
    };
    window.addEventListener('storage', onStorage);
    $effect.root(() => {
      $effect(() => {
        save();
      });
    });
    return;
  }
  const store = await load('settings.json', { defaults: {}, autoSave: false });
  const raw = await store.get('settings');
  if (raw === undefined && !(await storeIsReadable(store))) {
    loadFailed();
    return;
  }
  if (!applyInitial(raw, raw === undefined ? undefined : JSON.stringify(raw))) return;
  persistence = new SettingsPersistence(async (json) => {
    writingJson = json;
    try {
      await store.set('settings', JSON.parse(json));
      await store.save();
    } finally {
      writingJson = undefined;
    }
  }, initial);
  // Another window (dashboard <-> control panel) changed something: take it over.
  await store.onKeyChange('settings', (value) => {
    if (!value) return;
    try {
      applyRemote(value);
    } catch {
      loadFailed();
    }
  });
  $effect.root(() => {
    $effect(() => {
      save();
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

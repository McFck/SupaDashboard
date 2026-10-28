// One settings load/write/synchronization lifecycle per window.
import { load } from '@tauri-apps/plugin-store';
import { isTauri } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { storeIsReadable } from '$lib/store';
import { migrate } from './normalize';
import { SettingsPersistence } from './persistence';
import { type Settings } from './schema';

import { settings, serializeSettings } from './state.svelte';

const remoteSettingsListeners = new Set<(next: Settings) => void>();

export function onRemoteSettings(listener: (next: Settings) => void) {
  remoteSettingsListeners.add(listener);
  return () => remoteSettingsListeners.delete(listener);
}

type Source = {
  raw: unknown;
  /** The stored text; undefined when nothing was saved yet. */
  rawJson?: string;
  write(json: string): Promise<void>;
  /** `read` may throw on malformed data. */
  watch(onChange: (read: () => unknown) => void): void | Promise<void>;
};

export async function loadSettings() {
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
  const applyInitial = ({ raw, rawJson }: Source) => {
    try {
      if (rawJson !== undefined && raw == null) {
        throw new Error('Saved settings are empty');
      }
      const next = migrate(raw);
      // The store returns its own key order, so a current-version file is compared in normalized form.
      // An older file keeps its stored text and is rewritten at once.
      const current =
        rawJson !== undefined && (raw as { version?: unknown }).version === next.version;
      initial = current ? serializeSettings(next) : (rawJson ?? '');
      assign(next);
      return true;
    } catch {
      loadFailed();
      return false;
    }
  };
  const applyRemote = (read: () => unknown) => {
    try {
      const next = migrate(read());
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
      for (const listener of remoteSettingsListeners) {
        listener(next);
      }
      assign(next, settings.deck.activePage);
      persistence.saved = json;
    } catch {
      loadFailed();
    }
  };

  const source = isTauri() ? await openStore() : openBrowserStorage();
  if (!source || !applyInitial(source)) {
    return;
  }
  persistence = new SettingsPersistence(async (json) => {
    writingJson = json;
    try {
      await source.write(json);
    } finally {
      writingJson = undefined;
    }
  }, initial);
  await source.watch(applyRemote);
  $effect.root(() => {
    $effect(() => {
      save();
    });
  });

  function openBrowserStorage(): Source | undefined {
    const key = 'supadashboard:settings:v5';
    const rawJson =
      localStorage.getItem(key) ??
      ['supadashboard:settings:v6', 'supadashboard:settings:v4']
        .map((legacy) => localStorage.getItem(legacy))
        .find((value) => value !== null);
    let raw: unknown = null;
    if (rawJson != null) {
      try {
        raw = JSON.parse(rawJson);
      } catch {
        loadFailed();
        return;
      }
    }
    return {
      raw,
      rawJson: rawJson ?? undefined,
      write: async (json) => localStorage.setItem(key, json),
      watch: (onChange) => {
        window.addEventListener('storage', (event) => {
          if (event.key === key && event.newValue) {
            onChange(() => JSON.parse(event.newValue!));
          }
        });
      },
    };
  }

  async function openStore(): Promise<Source | undefined> {
    const store = await load('settings.json', { defaults: {}, autoSave: false });
    const raw = await store.get('settings');
    if (raw === undefined && !(await storeIsReadable(store))) {
      loadFailed();
      return;
    }
    return {
      raw,
      rawJson: raw === undefined ? undefined : JSON.stringify(raw),
      write: async (json) => {
        await store.set('settings', JSON.parse(json));
        await store.save();
      },
      // Another window (dashboard <-> control panel) changed something: take it over.
      watch: async (onChange) => {
        await store.onKeyChange('settings', (value) => {
          if (value) {
            onChange(() => value);
          }
        });
      },
    };
  }
}

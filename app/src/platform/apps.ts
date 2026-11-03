// Native app control: the picker's rows, commands, and the live state of watched apps.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isRecord } from '../features/automation/plain-data';
import type { AppRequest } from '../features/apps/keys';
import { readWindowSelection, type WindowSelection } from '../features/apps/window-selection';

export type AppWindowSelection = WindowSelection & { slug: string };

export type WatchedApp = {
  key: string;
  slug: string;
  running: boolean;
  focused: boolean;
  minimized: boolean;
  visible: boolean;
  display: string;
  selection?: WindowSelection;
};
export type AppRow = {
  key: string;
  label: string;
  slug: string;
  detail: string;
  running: boolean;
};

const FLAGS = ['running', 'focused', 'minimized', 'visible'] as const;

/** Keeps the well-formed entries of an `apps-state` payload; anything else is dropped. */
export function parseWatched(raw: unknown): WatchedApp[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (item): item is WatchedApp =>
      isRecord(item) &&
      typeof item.key === 'string' &&
      typeof item.slug === 'string' &&
      /^[a-z0-9_-]+$/.test(item.slug) &&
      typeof item.display === 'string' &&
      (item.selection === undefined || !!readWindowSelection(item.selection)) &&
      FLAGS.every((flag) => typeof item[flag] === 'boolean'),
  );
}

export async function listApps(): Promise<AppRow[]> {
  const raw = await invoke<unknown>('apps_list');
  return Array.isArray(raw)
    ? raw.filter(
        (row): row is AppRow =>
          isRecord(row) &&
          typeof row.key === 'string' &&
          typeof row.label === 'string' &&
          typeof row.slug === 'string' &&
          typeof row.detail === 'string' &&
          typeof row.running === 'boolean',
      )
    : [];
}

/** The titles of an app's windows open right now. */
export async function listAppWindows(app: string): Promise<string[]> {
  const raw = await invoke<unknown>('app_windows', { app });
  return Array.isArray(raw)
    ? raw.filter((title): title is string => typeof title === 'string')
    : [];
}

export const runAppCommand = (request: AppRequest) => invoke<void>('app_command', { request });

export type AppsLink = {
  watch(keys: string[], selections: AppWindowSelection[]): void;
  stop(): void;
};

/**
 * One native subscription for the watched keys. `watch` replaces the set; an empty set releases the
 * native hooks. Native calls run in order, and a late reply after `stop` is dropped.
 */
export function appsLink(onState: (apps: WatchedApp[]) => void, onError: () => void): AppsLink {
  let epoch = 0;
  let unlisten: (() => void) | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (job: () => Promise<void>) => (queue = queue.catch(() => {}).then(job));
  return {
    watch(keys, selections) {
      if (!isTauri()) {
        return;
      }
      const mine = epoch;
      enqueue(async () => {
        if (mine !== epoch) {
          return;
        }
        if (!keys.length) {
          unlisten?.();
          unlisten = undefined;
          await invoke('apps_unwatch');
          return;
        }
        unlisten ??= await listen<unknown>('apps-state', (event) => {
          if (mine === epoch) {
            onState(parseWatched(event.payload));
          }
        });
        const snapshot = parseWatched(await invoke<unknown>('apps_watch', { keys, selections }));
        if (mine === epoch) {
          onState(snapshot);
        }
      }).catch(() => {
        if (mine === epoch) {
          onError();
        }
      });
    },
    stop() {
      epoch++;
      enqueue(async () => {
        unlisten?.();
        unlisten = undefined;
        await invoke('apps_unwatch');
      }).catch(() => {
        // The watcher thread also ends with the app; a failed release only delays that.
      });
    },
  };
}

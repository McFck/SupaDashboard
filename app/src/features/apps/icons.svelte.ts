// Shared decoded artwork: startup fills it before any saved tile mounts.
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'svelte-sonner';
import { loadAppIcon, readAppIcon } from '../../platform/apps';
import { isRecord } from '../automation/plain-data';
import { settings } from '../settings/state.svelte';
import { isAppKey, usedApps } from './keys';

const images = $state<Record<string, string | undefined>>({});
const requests = new Map<string, Promise<void>>();
export const appImage = (key: string) => images[key];

async function publish(key: string, image: string | undefined) {
  if (image) {
    const decoded = new Image();
    decoded.src = image;
    await decoded.decode();
  }
  images[key] = image;
}

export function requestAppIcon(key: string): Promise<void> {
  if (!isTauri() || !isAppKey(key)) {
    return Promise.resolve();
  }
  const pending = requests.get(key);
  if (pending) {
    return pending;
  }
  const request = loadAppIcon(key)
    .then((image) => publish(key, image))
    .catch(() => {
      toast.error('Could not load app icon');
    });
  requests.set(key, request);
  return request;
}

export function refreshAppIcon(key: string): Promise<void> {
  if (!isAppKey(key) || !isTauri()) {
    return Promise.resolve();
  }
  const previous = requests.get(key);
  const request = (async () => {
    await previous;
    const image = await loadAppIcon(key, true);
    await publish(key, image);
  })().catch(() => {
    toast.error('Could not refresh icon');
  });
  requests.set(key, request);
  return request;
}

export async function startAppIcons() {
  if (!isTauri()) {
    return () => {};
  }
  const unlisten = await listen<unknown>('app-icon', ({ payload }) => {
    if (!isRecord(payload) || !isAppKey(payload.key)) {
      return;
    }
    const image = readAppIcon(payload.bytes);
    if (image) {
      const key = payload.key;
      const previous = requests.get(key);
      const update = Promise.resolve(previous)
        .then(() => publish(key, image))
        .catch(() => {
          toast.error('Could not load app icon');
        });
      requests.set(key, update);
    }
  });
  await Promise.all(usedApps(settings.controls).map(requestAppIcon));
  return unlisten;
}

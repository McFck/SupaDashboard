import { onDestroy } from 'svelte';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ControlConfig } from '../model';
import {
  isVideoSource,
  mediaUrl,
  mediaFileUrl,
  readMediaOptions,
  type MediaSource,
} from '../../media/content';
import {
  cachedVideoThumbnail,
  captureVideoThumbnail,
  videoThumbnailKey,
} from '../../media/media-thumbnail';

export function mediaThumbnails(
  control: () => ControlConfig,
  sources: () => MediaSource[],
  tauriAvailable: () => boolean,
) {
  let thumbnailRevision = $state(0);
  let mounted = true;
  onDestroy(() => {
    mounted = false;
  });
  $effect(() => {
    const current = sources();
    const tauri = tauriAvailable();
    for (const source of current) {
      if (!isVideoSource(source) || source.thumbnail) {
        continue;
      }
      const key = videoThumbnailKey(source);
      if (cachedVideoThumbnail(key) || (!tauri && source.kind === 'file')) {
        continue;
      }
      const url = sourceUrl(source);
      if (!url) {
        continue;
      }
      void captureVideoThumbnail(key, url).then((thumbnail) => {
        if (!mounted || !thumbnail) {
          return;
        }
        thumbnailRevision++;
        if (thumbnail.persist) {
          persistThumbnail(source, thumbnail.dataUrl);
        }
      });
    }
  });

  function sourceUrl(source: MediaSource) {
    if (source.kind === 'url') {
      return mediaUrl(source.value);
    }
    return tauriAvailable() ? mediaFileUrl(source, convertFileSrc) : undefined;
  }
  function sourceThumbnail(source: MediaSource) {
    void thumbnailRevision;
    return (
      source.thumbnail ??
      (isVideoSource(source) ? cachedVideoThumbnail(videoThumbnailKey(source)) : sourceUrl(source))
    );
  }
  function persistThumbnail(source: MediaSource, thumbnail: string) {
    const current = readMediaOptions(control().options).sources;
    let changed = false;
    const next = current.map((entry) => {
      const matches = source.id
        ? entry.id === source.id
        : entry.kind === source.kind && entry.value === source.value;
      if (!matches || entry.thumbnail) {
        return entry;
      }
      changed = true;
      return { ...entry, thumbnail };
    });
    if (changed) {
      control().options = { ...(control().options ?? {}), sources: next };
    }
  }

  return sourceThumbnail;
}

import { isRecord } from '../automation/plain-data';

export type MediaSource = {
  id?: string;
  kind: 'file' | 'url';
  value: string;
  fit?: 'cover' | 'contain';
  loop?: boolean;
  muted?: boolean;
  thumbnail?: string;
};
export type MediaOptions = {
  sources: MediaSource[];
  interval: number;
  loop: boolean;
  muted: boolean;
};

export type WebOptions = { url: string; zoom: number; refresh: number; interactive: boolean };

export const DEFAULT_MEDIA_OPTIONS: MediaOptions = {
  sources: [],
  interval: 0,
  loop: true,
  muted: true,
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function webUrl(
  value: string,
  currentOrigin = typeof location === 'undefined' ? undefined : location.origin,
): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) ||
      ['tauri:', 'asset:'].includes(url.protocol) ||
      ['tauri.localhost', 'asset.localhost'].includes(url.hostname) ||
      url.origin === currentOrigin
    )
      return;
    return url.href;
  } catch {
    return;
  }
}

export function readWebOptions(value: unknown): WebOptions {
  const options = isRecord(value) ? value : {};
  return {
    url: typeof options.url === 'string' ? options.url : '',
    zoom:
      typeof options.zoom === 'number' && Number.isFinite(options.zoom)
        ? clamp(options.zoom, 50, 200)
        : 100,
    refresh: inRange(options.refresh, 1, 86400) ? options.refresh : 0,
    interactive: typeof options.interactive === 'boolean' ? options.interactive : false,
  };
}

export function readMediaOptions(value: unknown): MediaOptions {
  const options = isRecord(value) ? value : {};
  const legacyFit = options.fit === 'contain' ? 'contain' : 'cover';
  const sources = Array.isArray(options.sources)
    ? options.sources.flatMap((source): MediaSource[] => {
        if (!isRecord(source)) return [];
        const item = source;
        const thumbnail =
          typeof item.thumbnail === 'string' &&
          item.thumbnail.length <= 4096 &&
          /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(item.thumbnail)
            ? item.thumbnail
            : undefined;
        return (item.kind === 'file' || item.kind === 'url') &&
          typeof item.value === 'string' &&
          (item.kind !== 'file' || item.value.trim().length > 0)
          ? [
              {
                ...(typeof item.id === 'string' && item.id ? { id: item.id } : {}),
                ...(thumbnail ? { thumbnail } : {}),
                kind: item.kind,
                value: item.value,
                fit:
                  item.fit === 'contain' ? 'contain' : item.fit === 'cover' ? 'cover' : legacyFit,
                loop: typeof item.loop === 'boolean' ? item.loop : true,
                muted: typeof item.muted === 'boolean' ? item.muted : true,
              },
            ]
          : [];
      })
    : [];
  return {
    sources,
    interval: inRange(options.interval, 0, 86400)
      ? options.interval
      : DEFAULT_MEDIA_OPTIONS.interval,
    loop: typeof options.loop === 'boolean' ? options.loop : DEFAULT_MEDIA_OPTIONS.loop,
    muted: typeof options.muted === 'boolean' ? options.muted : DEFAULT_MEDIA_OPTIONS.muted,
  };
}

export function mediaUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
      return;
    return url.href;
  } catch {
    return;
  }
}

export function mediaFileUrl(
  source: MediaSource | undefined,
  convert: (path: string) => string,
): string | undefined {
  if (source?.kind !== 'file') return undefined;
  try {
    return convert(source.value);
  } catch {
    return undefined;
  }
}

function pathHasExtension(source: MediaSource, extensions: RegExp): boolean {
  try {
    return extensions.test(source.kind === 'url' ? new URL(source.value).pathname : source.value);
  } catch {
    return false;
  }
}

export const isVideoSource = (source: MediaSource) =>
  pathHasExtension(source, /.(?:mp4|m4v|webm|ogv)$/i);

export const hasMediaExtension = (source: MediaSource) =>
  pathHasExtension(source, /.(?:png|jpe?g|gif|webp|avif|bmp|mp4|m4v|webm|ogv)$/i);

export function mediaSourceKey(source: MediaSource | undefined) {
  return source ? JSON.stringify([source.kind, source.value]) : '';
}

export function sameMediaSource(left: MediaSource | undefined, right: MediaSource | undefined) {
  if (!left || !right) return false;
  return left.id && right.id
    ? left.id === right.id
    : mediaSourceKey(left) === mediaSourceKey(right);
}

export function mediaSourceType(source: MediaSource): 'image-file' | 'video-file' | 'url' {
  return source.kind === 'url' ? 'url' : isVideoSource(source) ? 'video-file' : 'image-file';
}

export function stepSlide(index: number, count: number, direction: -1 | 1, loop: boolean): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const last = Math.floor(count) - 1;
  const current = Number.isFinite(index) ? clamp(Math.trunc(index), 0, last) : 0;
  const next = current + direction;
  return loop ? (next + last + 1) % (last + 1) : clamp(next, 0, last);
}

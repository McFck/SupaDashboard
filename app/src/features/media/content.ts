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
  const options = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const zoom =
    typeof options.zoom === 'number' && Number.isFinite(options.zoom)
      ? Math.max(50, Math.min(200, options.zoom))
      : 100;
  const refresh =
    options.refresh === 0
      ? 0
      : typeof options.refresh === 'number' &&
          Number.isFinite(options.refresh) &&
          options.refresh >= 1 &&
          options.refresh <= 86400
        ? options.refresh
        : 0;
  return {
    url: typeof options.url === 'string' ? options.url : '',
    zoom,
    refresh,
    interactive: typeof options.interactive === 'boolean' ? options.interactive : false,
  };
}

export function readMediaOptions(value: unknown): MediaOptions {
  const options = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const legacyFit = options.fit === 'contain' ? 'contain' : 'cover';
  const sources = Array.isArray(options.sources)
    ? options.sources.flatMap((source): MediaSource[] => {
        if (!source || typeof source !== 'object') return [];
        const item = source as Record<string, unknown>;
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
    interval:
      typeof options.interval === 'number' &&
      Number.isFinite(options.interval) &&
      options.interval >= 0 &&
      options.interval <= 86400
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

export function isVideoSource(source: MediaSource): boolean {
  try {
    const path = source.kind === 'url' ? new URL(source.value).pathname : source.value;
    return /\.(?:mp4|m4v|webm|ogv)$/i.test(path);
  } catch {
    return false;
  }
}

export function hasMediaExtension(source: MediaSource): boolean {
  try {
    const path = source.kind === 'url' ? new URL(source.value).pathname : source.value;
    return /\.(?:png|jpe?g|gif|webp|avif|bmp|mp4|m4v|webm|ogv)$/i.test(path);
  } catch {
    return false;
  }
}

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
  const current = Number.isFinite(index) ? Math.max(0, Math.min(last, Math.trunc(index))) : 0;
  const next = current + direction;
  return loop ? (next + last + 1) % (last + 1) : Math.max(0, Math.min(last, next));
}

export type MediaSource = { kind: 'file' | 'url'; value: string };
export type MediaOptions = {
  sources: MediaSource[];
  fit: 'cover' | 'contain';
  interval: number;
  loop: boolean;
  muted: boolean;
};

export const DEFAULT_MEDIA_OPTIONS: MediaOptions = {
  sources: [], fit: 'cover', interval: 5, loop: true, muted: true,
};

export function readMediaOptions(value: unknown): MediaOptions {
  const options = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const sources = Array.isArray(options.sources) ? options.sources.flatMap((source): MediaSource[] => {
    if (!source || typeof source !== 'object') return [];
    const item = source as Record<string, unknown>;
    return (item.kind === 'file' || item.kind === 'url') && typeof item.value === 'string' &&
      (item.kind !== 'file' || item.value.trim().length > 0)
      ? [{ kind: item.kind, value: item.value }] : [];
  }) : [];
  return {
    sources,
    fit: options.fit === 'contain' ? 'contain' : 'cover',
    interval: typeof options.interval === 'number' && Number.isFinite(options.interval) &&
      options.interval >= 0 && options.interval <= 86400 ? options.interval : DEFAULT_MEDIA_OPTIONS.interval,
    loop: typeof options.loop === 'boolean' ? options.loop : DEFAULT_MEDIA_OPTIONS.loop,
    muted: typeof options.muted === 'boolean' ? options.muted : DEFAULT_MEDIA_OPTIONS.muted,
  };
}

export function mediaUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return;
    return url.href;
  } catch {
    return;
  }
}

export function isVideoSource(source: MediaSource): boolean {
  try {
    const path = source.kind === 'url' ? new URL(source.value).pathname : source.value;
    return /\.(?:mp4|m4v|webm|ogv)$/i.test(path);
  }
  catch { return false; }
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

export function appendPickedSources(original: readonly MediaSource[], options: unknown, selection: string | string[] | null) {
  const paths = (Array.isArray(selection) ? selection : selection ? [selection] : []).filter(value => value.trim().length > 0);
  const current = readMediaOptions(options).sources;
  if (!paths.length || JSON.stringify(current) !== JSON.stringify(original)) return;
  return [...current, ...paths.map(value => ({ kind: 'file' as const, value }))];
}

export function stepSlide(index: number, count: number, direction: -1 | 1, loop: boolean): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const last = Math.floor(count) - 1;
  const current = Number.isFinite(index) ? Math.max(0, Math.min(last, Math.trunc(index))) : 0;
  const next = current + direction;
  return loop ? (next + last + 1) % (last + 1) : Math.max(0, Math.min(last, next));
}

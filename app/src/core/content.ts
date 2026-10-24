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
    return (item.kind === 'file' || item.kind === 'url') && typeof item.value === 'string'
      ? [{ kind: item.kind, value: item.value }] : [];
  }) : [];
  return {
    sources,
    fit: options.fit === 'contain' ? 'contain' : 'cover',
    interval: typeof options.interval === 'number' && Number.isFinite(options.interval) &&
      options.interval >= 1 && options.interval <= 86400 ? options.interval : DEFAULT_MEDIA_OPTIONS.interval,
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
  if (source.kind !== 'url') return false;
  try { return /\.(?:mp4|m4v|webm|ogv)$/i.test(new URL(source.value).pathname); }
  catch { return false; }
}

export function stepSlide(index: number, count: number, direction: -1 | 1, loop: boolean): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const last = Math.floor(count) - 1;
  const current = Number.isFinite(index) ? Math.max(0, Math.min(last, Math.trunc(index))) : 0;
  const next = current + direction;
  return loop ? (next + last + 1) % (last + 1) : Math.max(0, Math.min(last, next));
}

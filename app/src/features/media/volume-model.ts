export type Channel = {
  target: string;
  volume: number;
  muted: boolean;
  label?: string;
  icon?: string;
};
export type VolumeSnapshot = { revision: number; deviceId: string | null; channels: Channel[] };
export type VolumePatch = { value?: number; muted?: boolean };

export function normalizeTarget(target: string) {
  const normalized = target.trim().toLowerCase();
  return normalized.endsWith('.exe') ? normalized.slice(0, -4) : normalized;
}

export function clampVolume(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function applyVolumePatch(channel: Channel, patch: VolumePatch): Channel {
  return {
    ...channel,
    ...(patch.value === undefined ? {} : { volume: patch.value }),
    ...(patch.muted === undefined ? {} : { muted: patch.muted }),
  };
}

function validChannel(value: unknown): value is Channel {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<Channel>;
  return (
    typeof item.target === 'string' &&
    !!normalizeTarget(item.target) &&
    typeof item.volume === 'number' &&
    Number.isFinite(item.volume) &&
    item.volume >= 0 &&
    item.volume <= 1 &&
    typeof item.muted === 'boolean'
  );
}

/** System first, then by target; native targets are normalized and deduplicated. */
function compareTargets(a: Channel, b: Channel) {
  if (a.target === b.target) {
    return 0;
  }
  if (a.target === 'system') {
    return -1;
  }
  if (b.target === 'system') {
    return 1;
  }
  return a.target.localeCompare(b.target);
}

/** Validates a native `audio-state` payload; any malformed channel rejects the whole snapshot. */
export function parseVolumeSnapshot(snapshot: unknown): VolumeSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const raw = snapshot as Partial<VolumeSnapshot>;
  const revision = raw.revision;
  const deviceId = raw.deviceId;
  if (
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !(deviceId === null || (typeof deviceId === 'string' && deviceId.length > 0)) ||
    !Array.isArray(raw.channels) ||
    !raw.channels.every(validChannel)
  ) {
    return null;
  }
  const channels = raw.channels
    .map((item) => ({
      target: normalizeTarget(item.target),
      volume: item.volume,
      muted: item.muted,
    }))
    .sort(compareTargets);
  const unique = channels.filter(
    (channel, index) => index === 0 || channels[index - 1].target !== channel.target,
  );
  if (deviceId === null && unique.length) {
    return null;
  }
  return { revision, deviceId, channels: unique };
}

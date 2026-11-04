import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isRecord } from '../features/automation/plain-data';

type VoiceUser = { id: string; name: string };
type VoiceChannel = VoiceUser & { kind: 'guild' | 'dm'; guildId?: string };
export type VoiceMember = VoiceUser & {
  avatar: string | null;
  discriminator: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
};
type Connected = {
  user: VoiceUser;
  muted: boolean;
  deafened: boolean;
  lastChannel?: VoiceChannel;
};
export type VoiceView =
  | { state: 'absent' | 'needsAuth' | 'authorizing' | 'connecting' }
  | (Connected & { state: 'idle' })
  | (Connected & { state: 'inVoice'; channel: VoiceChannel; members: VoiceMember[] });
type VoiceCommand = 'toggleMute' | 'toggleDeaf' | 'leave' | 'rejoin';

const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9]{17,20}$/.test(id);
const validAvatar = (hash: unknown): hash is string =>
  typeof hash === 'string' && /^(a_)?[0-9a-f]{32}$/.test(hash);
const validDiscriminator = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9]{1,4}$/.test(value);

function readUser(raw: unknown): VoiceUser | undefined {
  if (
    !isRecord(raw) ||
    !validId(raw.id) ||
    typeof raw.name !== 'string' ||
    !raw.name.length ||
    raw.name.length > 128 ||
    [...raw.name].length > 64 ||
    raw.name.trim() !== raw.name ||
    /[\u0000-\u001f\u007f-\u009f]/.test(raw.name)
  ) {
    return undefined;
  }
  return { id: raw.id, name: raw.name };
}

function readChannel(raw: unknown): VoiceChannel | undefined {
  const user = readUser(raw);
  if (
    !user ||
    !isRecord(raw) ||
    (raw.kind !== 'guild' && raw.kind !== 'dm') ||
    (raw.guildId !== undefined && !validId(raw.guildId))
  ) {
    return undefined;
  }
  return {
    ...user,
    kind: raw.kind,
    ...(raw.guildId === undefined ? {} : { guildId: raw.guildId }),
  };
}

function readMember(raw: unknown): VoiceMember | undefined {
  const user = readUser(raw);
  if (
    !user ||
    !isRecord(raw) ||
    (raw.avatar !== null && typeof raw.avatar !== 'string') ||
    !validDiscriminator(raw.discriminator) ||
    typeof raw.speaking !== 'boolean' ||
    typeof raw.muted !== 'boolean' ||
    typeof raw.deafened !== 'boolean'
  ) {
    return undefined;
  }
  const member: VoiceMember = {
    ...user,
    avatar: raw.avatar,
    discriminator: raw.discriminator,
    speaking: raw.speaking,
    muted: raw.muted,
    deafened: raw.deafened,
  };
  return avatarUrl(member) ? member : undefined;
}

/** Unknown fields are discarded; malformed snapshots never become live state. */
export function readVoiceView(raw: unknown): VoiceView | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const state = raw.state;
  if (
    state === 'absent' ||
    state === 'needsAuth' ||
    state === 'authorizing' ||
    state === 'connecting'
  ) {
    return { state };
  }
  const user = readUser(raw.user);
  const lastChannel = raw.lastChannel === undefined ? undefined : readChannel(raw.lastChannel);
  if (
    !user ||
    typeof raw.muted !== 'boolean' ||
    typeof raw.deafened !== 'boolean' ||
    (raw.lastChannel !== undefined && lastChannel?.kind !== 'guild')
  ) {
    return undefined;
  }
  const connected: Connected = {
    user,
    muted: raw.muted,
    deafened: raw.deafened,
    ...(lastChannel ? { lastChannel } : {}),
  };
  if (state === 'idle') {
    return { state, ...connected };
  }
  const channel = readChannel(raw.channel);
  if (state !== 'inVoice' || !channel || !Array.isArray(raw.members) || raw.members.length > 99) {
    return undefined;
  }
  const members = raw.members.map(readMember);
  if (members.some((member) => member === undefined)) {
    return undefined;
  }
  const valid = members.filter((member) => member !== undefined);
  if (new Set(valid.map((member) => member.id)).size !== valid.length) {
    return undefined;
  }
  return { state, ...connected, channel, members: valid };
}

/** Passing a null avatar also supplies the image-error fallback for a validated member. */
export function avatarUrl(
  member: Pick<VoiceMember, 'id' | 'avatar' | 'discriminator'>,
): string | undefined {
  if (!validId(member.id) || !validDiscriminator(member.discriminator)) {
    return undefined;
  }
  if (member.avatar !== null) {
    return validAvatar(member.avatar)
      ? `https://cdn.discordapp.com/avatars/${member.id}/${member.avatar}.png?size=128`
      : undefined;
  }
  const index =
    member.discriminator === '0'
      ? Number((BigInt(member.id) >> 22n) % 6n)
      : Number(member.discriminator) % 5;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

const listeners = new Set<(view: VoiceView) => void>();
let latest: VoiceView = { state: 'absent' };
let epoch = 0;
let unlisten: (() => void) | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (job: () => Promise<void>) =>
  (queue = queue
    .catch(() => {
      // Each queued operation reports its own failure; a failed start must not prevent cleanup.
    })
    .then(job));

function deliver(raw: unknown) {
  latest = readVoiceView(raw) ?? { state: 'needsAuth' };
  for (const listener of [...listeners]) {
    listener(latest);
  }
}

function startHub() {
  const mine = ++epoch;
  enqueue(async () => {
    if (mine !== epoch) {
      return;
    }
    unlisten?.();
    let receivedEvent = false;
    unlisten = await listen<unknown>('discord-state', (event) => {
      if (mine === epoch) {
        receivedEvent = true;
        deliver(event.payload);
      }
    });
    const snapshot = await invoke<unknown>('discord_subscribe');
    // Events can arrive while invoke is returning an older snapshot.
    if (mine === epoch && !receivedEvent) {
      deliver(snapshot);
    }
  }).catch(() => {
    if (mine === epoch) {
      deliver({ state: 'absent' });
      retry = setTimeout(startHub, 5000);
    }
  });
}

export function subscribeVoice(listener: (view: VoiceView) => void): () => void {
  if (!isTauri()) {
    listener({ state: 'absent' });
    return () => {};
  }
  const receive = (view: VoiceView) => listener(view);
  listeners.add(receive);
  receive(latest);
  if (listeners.size === 1) {
    startHub();
  }
  return () => {
    if (!listeners.delete(receive) || listeners.size) {
      return;
    }
    epoch++;
    clearTimeout(retry);
    latest = { state: 'absent' };
    enqueue(async () => {
      unlisten?.();
      unlisten = undefined;
      await invoke('discord_unsubscribe');
    }).catch(() => {
      // Native also releases the subscriber when its window closes.
    });
  };
}

async function command(name: string, args?: Record<string, unknown>) {
  if (!isTauri()) {
    throw new Error("Discord isn't running");
  }
  await queue;
  if (!listeners.size) {
    throw new Error('Connect Discord first');
  }
  await invoke<void>(name, args);
}

export async function authorize(clientId: string) {
  const id = clientId.trim();
  if (!validId(id)) {
    throw new Error('Invalid Discord client ID');
  }
  await command('discord_authorize', { clientId: id });
}

export const logout = () => command('discord_logout');

export async function voiceCommand(voice: VoiceCommand) {
  await queue;
  if (latest.state === 'absent') {
    throw new Error("Discord isn't running");
  }
  if (latest.state !== 'idle' && latest.state !== 'inVoice') {
    throw new Error('Connect Discord first');
  }
  if (voice === 'leave' && latest.state !== 'inVoice') {
    throw new Error('Not in a voice channel');
  }
  if (voice === 'rejoin' && !latest.lastChannel) {
    throw new Error('No channel to rejoin');
  }
  await command('discord_voice', { command: voice });
}

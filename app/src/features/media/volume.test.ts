import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const transport = vi.hoisted(() => ({
  isTauri: true,
  listen: vi.fn(),
  invoke: vi.fn(),
  handler: null as null | ((event: { payload: unknown }) => void),
  order: [] as string[],
  unlisten: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => transport.isTauri,
  invoke: (...args: unknown[]) => transport.invoke(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => transport.listen(...args),
}));

const makeSnapshot = (
  revision = 1,
  deviceId: string | null = 'device-a',
  channels = [
    { target: 'system', volume: 0.42, muted: false },
    { target: 'discord', volume: 0.7, muted: false },
    { target: 'vlc', volume: 0.2, muted: true },
  ],
) => ({ revision, deviceId, channels });

function installWindowEvents() {
  const callbacks = new Map<string, Set<() => void>>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: (name: string, callback: () => void) => {
        const listeners = callbacks.get(name) ?? new Set();
        listeners.add(callback);
        callbacks.set(name, listeners);
      },
      removeEventListener: (name: string, callback: () => void) =>
        callbacks.get(name)?.delete(callback),
      dispatchEvent: (event: Event) => {
        for (const callback of callbacks.get(event.type) ?? []) callback();
        return true;
      },
    },
  });
}

async function loadVolume(snapshot = makeSnapshot()) {
  installWindowEvents();
  transport.isTauri = true;
  transport.handler = null;
  transport.order = [];
  transport.unlisten = vi.fn();
  transport.listen.mockImplementation(
    async (_event: string, handler: (event: { payload: unknown }) => void) => {
      transport.order.push('listen');
      transport.handler = handler;
      return transport.unlisten;
    },
  );
  transport.invoke.mockImplementation(async (command: string) => {
    transport.order.push(command);
    if (command === 'audio_snapshot') return snapshot;
    throw new Error(`Unexpected IPC: ${command}`);
  });
  vi.resetModules();
  return import('./volume');
}

async function flushMicrotasks() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

afterEach(() => {
  (globalThis as { window?: Window }).window?.dispatchEvent(new Event('beforeunload'));
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('shared volume stream', () => {
  it('registers one listener before the initial snapshot and shares the in-flight init', async () => {
    const volume = await loadVolume();
    const first = volume.initVolumeSync();
    const second = volume.initVolumeSync();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(transport.order).toEqual(['listen', 'audio_snapshot']);
    expect(transport.listen).toHaveBeenCalledTimes(1);
    expect(get(volume.volumeChannels)).toEqual(makeSnapshot().channels);
  });

  it('keeps a newer event when the delayed initial snapshot arrives, and ignores invalid or stale data', async () => {
    let resolveSnapshot!: (snapshot: unknown) => void;
    const volume = await loadVolume();
    transport.invoke.mockImplementation((command: string) => {
      transport.order.push(command);
      return new Promise((resolve) => {
        resolveSnapshot = resolve;
      });
    });
    const initialized = volume.initVolumeSync();
    await flushMicrotasks();
    transport.handler?.({
      payload: makeSnapshot(2, 'device-a', [
        { target: 'system', volume: 0.8, muted: true },
        { target: 'discord', volume: 0.4, muted: false },
      ]),
    });
    transport.handler?.({ payload: makeSnapshot(2) });
    transport.handler?.({
      payload: {
        revision: 3,
        deviceId: 'device-a',
        channels: [{ target: 'system', volume: 3, muted: false }],
      },
    });
    resolveSnapshot(makeSnapshot(1));
    await initialized;
    expect(get(volume.volumeChannels)).toEqual([
      { target: 'system', volume: 0.8, muted: true },
      { target: 'discord', volume: 0.4, muted: false },
    ]);
  });

  it('uses normalized stable selectors and reflects apps appearing, disappearing and no device', async () => {
    const volume = await loadVolume();
    await volume.initVolumeSync();
    expect(await volume.readVolume(' DISCORD.EXE ')).toBe(0.7);
    expect(volume.findVolumeChannel(get(volume.volumeChannels), 'sys')).toEqual(
      get(volume.volumeChannels)[0],
    );
    transport.handler?.({
      payload: makeSnapshot(2, 'device-a', [{ target: 'system', volume: 0.5, muted: false }]),
    });
    expect(await volume.readVolume('discord')).toBeNull();
    transport.handler?.({
      payload: makeSnapshot(3, 'device-a', [
        { target: 'system', volume: 0.5, muted: false },
        { target: 'discord.exe', volume: 0.6, muted: false },
      ]),
    });
    expect(await volume.readVolume('discord')).toBe(0.6);
    transport.handler?.({ payload: makeSnapshot(4, null, []) });
    expect(get(volume.volumeChannels)).toEqual([]);
    expect(await volume.readVolume('system')).toBeNull();
  });

  it('coalesces rapid writes, retains the last value and limits sends per target', async () => {
    vi.useFakeTimers();
    let current = makeSnapshot();
    const sentAt: number[] = [];
    const volume = await loadVolume(current);
    transport.invoke.mockImplementation(
      async (command: string, args: { target: string; value?: number; muted?: boolean }) => {
        if (command === 'audio_snapshot') return current;
        if (command !== 'audio_update') throw new Error(`Unexpected IPC: ${command}`);
        sentAt.push(Date.now());
        current = {
          ...current,
          revision: current.revision + 1,
          channels: current.channels.map((channel) =>
            channel.target === args.target
              ? {
                  ...channel,
                  ...(args.value === undefined ? {} : { volume: args.value }),
                  ...(args.muted === undefined ? {} : { muted: args.muted }),
                }
              : channel,
          ),
        };
        return { applied: true, snapshot: current };
      },
    );
    await volume.initVolumeSync();
    const writes = Array.from({ length: 100 }, (_, index) =>
      volume.setVolume('SYSTEM.EXE', index / 100),
    );
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all(writes);
    expect(sentAt.length).toBeLessThanOrEqual(20);
    expect(sentAt.every((time, index) => index === 0 || time - sentAt[index - 1] >= 50)).toBe(true);
    expect(get(volume.volumeChannels)[0].volume).toBe(0.99);
  });

  it('retains the per-target rate limit across individually awaited writes', async () => {
    vi.useFakeTimers();
    let current = makeSnapshot();
    const sentAt: number[] = [];
    const volume = await loadVolume(current);
    transport.invoke.mockImplementation(
      async (command: string, args: { target: string; value?: number }) => {
        if (command === 'audio_snapshot') return current;
        if (command !== 'audio_update') throw new Error(`Unexpected IPC: ${command}`);
        sentAt.push(Date.now());
        current = {
          ...current,
          revision: current.revision + 1,
          channels: current.channels.map((channel) =>
            channel.target === args.target
              ? { ...channel, volume: args.value ?? channel.volume }
              : channel,
          ),
        };
        return { applied: true, snapshot: current };
      },
    );
    await volume.initVolumeSync();
    const first = volume.setVolume('system', 0.2);
    await flushMicrotasks();
    await first;
    const second = volume.setVolume('system', 0.4);
    await flushMicrotasks();
    expect(sentAt).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(49);
    expect(sentAt).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(sentAt).toHaveLength(2);
    expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(50);
  });

  it('keeps a newer optimistic value through an older acknowledgement and merges mute with value', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (result: unknown) => void;
    let current = makeSnapshot();
    const requests: Array<{ target: string; deviceId: string; value?: number; muted?: boolean }> =
      [];
    const volume = await loadVolume(current);
    transport.invoke.mockImplementation((command: string, args: (typeof requests)[number]) => {
      if (command === 'audio_snapshot') return Promise.resolve(current);
      requests.push(args);
      if (requests.length === 1)
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      const previous = current.channels.find((channel) => channel.target === args.target)!;
      current = {
        ...current,
        revision: current.revision + 1,
        channels: current.channels.map((channel) =>
          channel.target === args.target
            ? {
                ...channel,
                ...(args.value === undefined ? {} : { volume: args.value }),
                ...(args.muted === undefined ? {} : { muted: args.muted }),
              }
            : channel,
        ),
      };
      expect(previous.target).toBe(args.target);
      return Promise.resolve({ applied: true, snapshot: current });
    });
    await volume.initVolumeSync();
    const first = volume.setVolume('system', 0.2);
    await flushMicrotasks();
    const second = volume.setVolume('system', 0.8);
    const third = volume.setMuted('system', true);
    await flushMicrotasks();
    expect(get(volume.volumeChannels)[0]).toMatchObject({ volume: 0.8, muted: true });
    current = makeSnapshot(2, 'device-a', [
      { target: 'system', volume: 0.2, muted: false },
      ...current.channels.slice(1),
    ]);
    resolveFirst({ applied: true, snapshot: current });
    await first;
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([second, third]);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      target: 'system',
      value: 0.8,
      muted: true,
      deviceId: 'device-a',
    });
    expect(get(volume.volumeChannels)[0]).toMatchObject({ volume: 0.8, muted: true });
  });

  it('keeps target queues independent and rejects obsolete writes on device change', async () => {
    vi.useFakeTimers();
    let resolveSystem!: (result: unknown) => void;
    const volume = await loadVolume();
    const requests: string[] = [];
    transport.invoke.mockImplementation((command: string, args: { target: string }) => {
      if (command === 'audio_snapshot') return Promise.resolve(makeSnapshot());
      requests.push(args.target);
      if (args.target === 'system')
        return new Promise((resolve) => {
          resolveSystem = resolve;
        });
      return Promise.resolve({
        applied: true,
        snapshot: makeSnapshot(2, 'device-a', [
          { target: 'system', volume: 0.42, muted: false },
          { target: 'discord', volume: 0.6, muted: false },
          { target: 'vlc', volume: 0.2, muted: true },
        ]),
      });
    });
    await volume.initVolumeSync();
    const system = volume.setVolume('system', 0.1).then(
      () => null,
      (error) => error as Error,
    );
    const obsolete = volume.setVolume('system', 0.9).then(
      () => null,
      (error) => error as Error,
    );
    const discord = volume.setVolume('discord', 0.6).then(
      () => null,
      (error) => error as Error,
    );
    await flushMicrotasks();
    expect(requests).toContain('system');
    expect(requests).toContain('discord');
    transport.handler?.({
      payload: makeSnapshot(3, 'device-b', [
        { target: 'system', volume: 0.65, muted: false },
        { target: 'discord', volume: 0.6, muted: false },
      ]),
    });
    expect((await system)?.message).toMatch(/device changed/i);
    expect((await obsolete)?.message).toMatch(/device changed/i);
    expect(await discord).toBeNull();
    resolveSystem({ applied: true, snapshot: makeSnapshot(3) });
    await flushMicrotasks();
    expect(get(volume.volumeChannels)[0]).toMatchObject({ volume: 0.65 });
  });

  it('clears optimistic state on failure, unlistens, and allows initialization retry', async () => {
    const volume = await loadVolume();
    await volume.initVolumeSync();
    transport.invoke.mockRejectedValueOnce(new Error('write failed'));
    await expect(volume.setVolume('system', 0.9)).rejects.toThrow('write failed');
    expect(get(volume.volumeChannels)[0].volume).toBe(0.42);
    window.dispatchEvent(new Event('beforeunload'));
    expect(transport.unlisten).toHaveBeenCalledTimes(1);
    expect(get(volume.volumeChannels)).toEqual([]);
    transport.listen.mockImplementationOnce(
      async (_event: string, handler: (event: { payload: unknown }) => void) => {
        transport.handler = handler;
        return transport.unlisten;
      },
    );
    transport.invoke.mockResolvedValueOnce(makeSnapshot(7));
    await volume.initVolumeSync();
    expect(get(volume.volumeChannels)).toEqual(makeSnapshot(7).channels);
  });

  it('registers an exact-ID local channel and routes its writes without native initialization', async () => {
    const volume = await loadVolume();
    let current = { volume: 0.7, muted: false };
    const setLocalVolume = vi.fn((value: number) => {
      current = { ...current, volume: value };
    });
    const setLocalMuted = vi.fn((muted: boolean) => {
      current = { ...current, muted };
    });
    const stop = volume.registerLocalVolumeChannel('subway:immersion', {
      label: 'Subway',
      icon: 'TrainFront',
      read: () => current,
      setVolume: setLocalVolume,
      setMuted: setLocalMuted,
    });
    expect(get(volume.volumeChannels)).toContainEqual({
      target: 'subway:immersion',
      volume: 0.7,
      muted: false,
      label: 'Subway',
      icon: 'TrainFront',
    });
    expect(volume.findVolumeChannel(get(volume.volumeChannels), 'subway:immersion')?.label).toBe(
      'Subway',
    );
    await volume.setVolume('subway:immersion', 1.4);
    await volume.setMuted('subway:immersion', true);
    expect(setLocalVolume).toHaveBeenCalledWith(1);
    expect(setLocalMuted).toHaveBeenCalledWith(true);
    expect(transport.listen).not.toHaveBeenCalled();
    expect(transport.invoke).not.toHaveBeenCalled();
    expect(get(volume.volumeChannels)).toContainEqual(
      expect.objectContaining({ volume: 1, muted: true }),
    );
    stop();
    expect(get(volume.volumeChannels)).toEqual([]);
  });

  it('keeps a local channel through empty native snapshots and gives exact targets priority', async () => {
    const volume = await loadVolume();
    await volume.initVolumeSync();
    let current = { volume: 0.4, muted: false };
    volume.registerLocalVolumeChannel('subway:immersion', {
      read: () => current,
      setVolume: (value) => {
        current = { ...current, volume: value };
      },
      setMuted: (muted) => {
        current = { ...current, muted };
      },
    });
    transport.handler?.({ payload: makeSnapshot(2, null, []) });
    expect(get(volume.volumeChannels)).toContainEqual(
      expect.objectContaining({ target: 'subway:immersion', volume: 0.4 }),
    );
    expect(
      volume.findVolumeChannel(
        [
          { target: 'subway', volume: 0.2, muted: false },
          { target: 'subway:immersion', volume: 0.8, muted: true },
        ],
        'subway:immersion',
      )?.volume,
    ).toBe(0.8);
  });

  it('rejects a local target that collides with an existing native channel', async () => {
    const volume = await loadVolume();
    await volume.initVolumeSync();
    expect(() =>
      volume.registerLocalVolumeChannel('discord', {
        read: () => ({ volume: 1, muted: false }),
        setVolume: () => {},
        setMuted: () => {},
      }),
    ).toThrow(/already provided by the system/i);
  });
});

describe('local volume registration', () => {
  it('releases the target when the adapter subscription throws, so it can register again', async () => {
    const volume = await loadVolume();
    const adapter = {
      read: () => ({ volume: 0.5, muted: false }),
      setVolume: () => {},
      setMuted: () => {},
    };
    expect(() =>
      volume.registerLocalVolumeChannel('subway:immersion', {
        ...adapter,
        subscribe: () => {
          throw new Error('subscribe failed');
        },
      }),
    ).toThrow('subscribe failed');
    expect(get(volume.volumeChannels)).toEqual([]);
    const stop = volume.registerLocalVolumeChannel('subway:immersion', adapter);
    expect(get(volume.volumeChannels)).toContainEqual(
      expect.objectContaining({ target: 'subway:immersion', volume: 0.5 }),
    );
    stop();
  });
});

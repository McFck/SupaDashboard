import { afterEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  native: false,
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => storage.native }));
vi.mock('@tauri-apps/plugin-store', () => ({
  load: async () => ({
    get: storage.get,
    set: storage.set,
    save: storage.save,
    reload: storage.reload,
  }),
}));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));

import { toast } from 'svelte-sonner';
import { loadSettings, settings } from './state.svelte';
import { DEFAULTS } from './schema';

afterEach(() => {
  Object.assign(settings, structuredClone(DEFAULTS));
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('settings load recovery', () => {
  it.each([
    '{truncated',
    'null',
    '[]',
    '{"version":99}',
    '{"version":5,"controls":{}}',
    '{"version":5,"controls":[null]}',
  ])('starts without overwriting corrupt browser settings: %s', async (raw) => {
    storage.native = false;
    const values = new Map([['supadashboard:settings:v5', raw]]);
    const setItem = vi.fn((key: string, value: string) => values.set(key, value));
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem });
    await expect(loadSettings()).resolves.toBeUndefined();
    expect(values.get('supadashboard:settings:v5')).toBe(raw);
    expect(setItem).not.toHaveBeenCalled();
    expect(settings).toEqual(DEFAULTS);
    expect(toast.error).toHaveBeenCalled();
  });

  it('keeps malformed native settings untouched while allowing startup to finish', async () => {
    storage.native = true;
    const raw = { version: 5, controls: { unrecovered: 'keep me' } };
    storage.get.mockResolvedValue(raw);
    await expect(loadSettings()).resolves.toBeUndefined();
    expect(raw.controls).toEqual({ unrecovered: 'keep me' });
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('does not save defaults over a native settings file the store could not parse', async () => {
    storage.native = true;
    storage.get.mockResolvedValue(undefined);
    storage.reload.mockRejectedValue('Failed to deserialize store. EOF while parsing');
    await expect(loadSettings()).resolves.toBeUndefined();
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});

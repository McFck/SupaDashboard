import { expect, it, vi } from 'vitest';
import type { PluginApi } from './contracts';
import { nativePlugins, refreshPlugins, startPlugins, stopPlugins } from './lifecycle';
import { actions, notifyTrigger, plugins, runAction } from './registry';

const fixture = vi.hoisted(() => ({
  inventory: vi.fn(),
  loadPlugin: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', async (original) => ({
  ...(await original<typeof import('@tauri-apps/api/core')>()),
  isTauri: () => true,
}));
vi.mock('../../platform/plugin-host', async (original) => ({
  ...(await original<typeof import('../../platform/plugin-host')>()),
  listPlugins: fixture.inventory,
  onPluginsChanged: async () => () => {},
}));
vi.mock('./external/load', async (original) => ({
  ...(await original<typeof import('./external/load')>()),
  loadPlugin: fixture.loadPlugin,
}));

it('replaces a plugin once across overlapping refreshes and removes its actions and listeners', async () => {
  const entry = {
    id: 'spike',
    version: '1',
    revision: 1,
    api: 2,
    enabled: true,
    trust: 'verified',
    permissions: {},
    size: 3,
    updated: 0,
  };
  const first = vi.fn();
  const second = vi.fn();
  const rendered = vi.fn();
  const cleaned = vi.fn();
  let oldApi: PluginApi | undefined;
  fixture.loadPlugin.mockImplementation(async ({ revision }: typeof entry) => ({
    dispose: () => rendered(revision),
    plugin: {
      id: entry.id,
      title: entry.id,
      setup: (api: PluginApi) => {
        if (revision === 1) {
          oldApi = api;
        }
        api.onTrigger(revision === 1 ? first : second);
        api.registerAction({ id: 'spike.run', title: 'Run', run: () => revision });
        return () => cleaned(revision);
      },
    },
  }));
  fixture.inventory.mockResolvedValue({ plugins: [entry] });
  try {
    await startPlugins([]);
    notifyTrigger('press');
    expect(await runAction({ id: 'spike.run' })).toBe(1);
    fixture.inventory.mockResolvedValue({ plugins: [{ ...entry, revision: 2 }] });
    await Promise.all([refreshPlugins(), refreshPlugins()]);
    oldApi?.registerAction({ id: 'spike.stale', title: 'Stale', run: () => 0 });
    notifyTrigger('press');
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(cleaned.mock.calls).toEqual([[1]]);
    expect(rendered.mock.calls).toEqual([[1]]);
    expect(await runAction({ id: 'spike.run' })).toBe(2);
    expect(actions.has('spike.stale')).toBe(false);

    fixture.inventory.mockResolvedValue({ plugins: [] });
    await refreshPlugins();
    notifyTrigger('press');
    expect(second).toHaveBeenCalledOnce();
    expect(nativePlugins.has(entry.id)).toBe(false);
    expect(plugins.has(entry.id)).toBe(false);
    await expect(runAction({ id: 'spike.run' })).rejects.toThrow('Unknown action');
    expect(cleaned.mock.calls).toEqual([[1], [2]]);
    expect(rendered.mock.calls).toEqual([[1], [2]]);
  } finally {
    stopPlugins();
  }
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
  onKeyChange: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn(async () => store) }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('location', { reload: vi.fn() });
});

describe('plugin bookkeeping', () => {
  it('protects plugin installation state and rejects applet ownership collisions', async () => {
    const registry = await import('./registry');
    const setup = vi.fn();
    let ownerApi!: import('./contracts').PluginApi;
    store.get.mockResolvedValue({
      uninstalled: ['subway', 'spotify'],
      installed: { spotify: '2025-01-01T00:00:00.000Z' },
    });
    const spotify = {
      id: 'spotify',
      title: 'Spotify',
      default: true,
      setup: (api: import('./contracts').PluginApi) => {
        ownerApi = api;
        api.registerApplet({
          id: 'test.applet',
          title: 'Test applet',
          component: {} as import('svelte').Component,
          slots: [{ id: 'main', kind: 'grid', grid: 'page' }],
          views: [{ id: 'default', title: 'Default', slots: ['main'] }],
          defaultView: 'default',
          state: [{ key: 'ready', type: 'boolean', initialValue: false, persistent: true }],
          events: [
            {
              id: 'test.applet.changed',
              title: 'Applet changed',
              parameterSuggestions: () => [{ value: 'ready', label: 'Ready' }],
            },
          ],
        });
      },
    };
    await registry.installEnabled(spotify, { id: 'subway', title: 'Subway', setup });
    expect(setup).not.toHaveBeenCalled();
    const registeredApplet = registry.applets.get('test.applet')!;
    expect(() =>
      ownerApi.registerApplet({
        ...registeredApplet,
        views: [{ id: 'broken', title: 'Broken', slots: ['missing'] }],
      }),
    ).toThrow('slot references');
    expect(registry.applets.get('test.applet')).toBe(registeredApplet);
    registry.install({
      id: 'intruder',
      title: 'Intruder',
      setup: (api) => {
        api.registerVariable({
          id: 'test.applet.view',
          name: 'Reserved view',
          type: 'string',
          initialValue: 'external',
          persistent: false,
          readOnly: true,
        });
        api.registerApplet({
          id: 'test.other',
          title: 'Intruder applet',
          component: {} as import('svelte').Component,
          slots: [{ id: 'main', kind: 'grid', grid: 'page' }],
          views: [{ id: 'default', title: 'Default', slots: ['main'] }],
          defaultView: 'default',
          events: [{ id: 'test.other.changed', title: 'Other external event' }],
        });
      },
    });
    expect(() => ownerApi.registerApplet(registeredApplet)).toThrow('test.applet.view');
    expect(() =>
      ownerApi.registerApplet({
        ...registeredApplet,
        id: 'test.other',
        title: 'Other applet',
        events: [{ id: 'test.other.changed', title: 'Changed' }],
      }),
    ).toThrow('test.other.view');
    expect(registry.applets.get('test.applet')).toBe(registeredApplet);
    expect(store.set.mock.calls[0][1].installed.spotify).toBe('2025-01-01T00:00:00.000Z');
    expect(Number.isFinite(Date.parse(store.set.mock.calls[0][1].installed.subway))).toBe(true);
    await registry.setPluginEnabled('spotify', false);
    expect(location.reload).not.toHaveBeenCalled();
    await registry.setPluginEnabled('subway', true);
    expect(store.set.mock.calls.at(-1)![1].uninstalled).not.toContain('subway');
    expect(store.save).toHaveBeenCalled();
    expect(location.reload).toHaveBeenCalledOnce();
  });

  it('does not record a plugin until its setup succeeds', async () => {
    const registry = await import('./registry');
    const plugin = {
      id: 'broken',
      title: 'Broken',
      setup: () => {
        throw new Error('setup failed');
      },
    };
    expect(() => registry.install(plugin)).toThrow('setup failed');
    expect(registry.plugins.some((entry) => entry.id === plugin.id)).toBe(false);
  });
});

describe('status sources', () => {
  it('links only to the owning plugin media source and refuses host filter keys and foreign ids', async () => {
    const registry = await import('./registry');
    const source = (id: string, mediaSourceId?: string) => ({
      id,
      title: id,
      kind: 'nowPlaying' as const,
      mediaSourceId,
      subscribe: () => () => {},
    });
    registry.install({
      id: 'one',
      title: 'One',
      setup: (api) => {
        api.registerMediaSource({ id: 'one-media', title: 'One', command: async () => true });
        api.registerStatusSource(source('one', 'one-media'));
      },
    });
    const attempt = (setup: (api: import('./contracts').PluginApi) => void) =>
      registry.install({ id: `two-${Math.random()}`, title: 'Two', setup });
    expect(registry.statusSources.get('one')?.plugin).toBe('one');
    expect(() => attempt((api) => api.registerStatusSource(source('x', 'one-media')))).toThrow();
    expect(() => attempt((api) => api.registerStatusSource(source('one')))).toThrow();
    expect(() => attempt((api) => api.registerStatusSource(source('app:spotify')))).toThrow();
    expect(() => attempt((api) => api.registerStatusSource(source('known-app:x')))).toThrow();
  });
});

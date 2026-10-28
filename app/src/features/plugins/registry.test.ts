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
  it('skips removed plugins, preserves first-seen dates, protects defaults and records attribution', async () => {
    const registry = await import('./registry');
    const setup = vi.fn();
    let ownerApi!: import('./contracts').PluginApi;
    store.get.mockResolvedValue({
      uninstalled: ['subway', 'spotify'],
      installed: { spotify: '2025-01-01T00:00:00.000Z' },
      catalogUrl: '',
    });
    const spotify = {
      id: 'spotify',
      title: 'Spotify',
      default: true,
      setup: (api: import('./contracts').PluginApi) => {
        ownerApi = api;
        api.registerAction({ id: 'test.play', title: 'Play', run: () => {} });
        api.registerValue({
          id: 'test.volume',
          title: 'Volume',
          get: async () => 1,
          set: async () => {},
        });
        api.registerControl({
          type: 'test.control',
          title: 'Test',
          icon: 'Puzzle',
          component: {} as import('svelte').Component,
          size: { w: 1, h: 1 },
          create: () => ({ name: 'Test', variants: [{ label: '' }] }),
        });
        api.registerSkin({
          id: 'test.skin',
          title: 'Test skin',
          component: {} as import('svelte').Component,
          slots: [{ id: 'main', style: 'region', kind: 'grid', grid: 'page' }],
          views: [{ id: 'default', title: 'Default', slots: ['main'] }],
          defaultView: 'default',
          state: [{ key: 'ready', type: 'boolean', initialValue: false, persistent: true }],
          events: [
            {
              id: 'test.skin.changed',
              title: 'Skin changed',
              parameterSuggestions: () => [{ value: 'ready', label: 'Ready' }],
            },
          ],
        });
        api.registerIcon('TestIcon', 'M2 2');
        api.registerMediaSource({ id: 'test.source', title: 'Source', command: async () => {} });
      },
    };
    await registry.installEnabled(spotify, { id: 'subway', title: 'Subway', setup });
    expect(setup).not.toHaveBeenCalled();
    expect(registry.actions.get('test.play')?.plugin).toBe('spotify');
    expect(registry.values.get('test.volume')?.plugin).toBe('spotify');
    expect(registry.controlTypes.get('test.control')?.plugin).toBe('spotify');
    expect(registry.skins.get('test.skin')?.plugin).toBe('spotify');
    expect(
      ownerApi
        .listVariables()
        .filter((record) => record.definition.id.startsWith('test.skin.'))
        .map((record) => ({
          id: record.definition.id,
          owner: record.definition.owner,
          type: record.definition.type,
          initialValue: record.definition.initialValue,
          persistent: record.definition.persistent,
          readOnly: record.definition.readOnly,
        })),
    ).toEqual([
      {
        id: 'test.skin.view',
        owner: 'spotify',
        type: 'string',
        initialValue: 'default',
        persistent: false,
        readOnly: true,
      },
      {
        id: 'test.skin.ready',
        owner: 'spotify',
        type: 'boolean',
        initialValue: false,
        persistent: true,
        readOnly: true,
      },
    ]);
    const skinEvent = registry.registeredEvents().find((event) => event.id === 'test.skin.changed');
    expect(typeof skinEvent?.parameterSuggestions).toBe('function');
    expect((skinEvent?.parameterSuggestions as () => { value: string; label: string }[])()).toEqual(
      [{ value: 'ready', label: 'Ready' }],
    );
    const registeredSkin = registry.skins.get('test.skin')!;
    expect(() =>
      ownerApi.registerSkin({
        ...registeredSkin,
        views: [{ id: 'broken', title: 'Broken', slots: ['missing'] }],
      }),
    ).toThrow('slot references');
    expect(registry.skins.get('test.skin')).toBe(registeredSkin);
    registry.install({
      id: 'intruder',
      title: 'Intruder',
      setup: (api) => {
        api.registerVariable({
          id: 'test.skin.view',
          name: 'Reserved view',
          type: 'string',
          initialValue: 'external',
          persistent: false,
          readOnly: true,
        });
        api.registerEvent({ id: 'test.skin.changed', title: 'External event' });
        api.registerEvent({ id: 'test.other.changed', title: 'Other external event' });
      },
    });
    expect(() => ownerApi.registerSkin(registeredSkin)).toThrow('test.skin.view');
    expect(() =>
      ownerApi.registerSkin({
        ...registeredSkin,
        id: 'test.other',
        title: 'Other skin',
        events: [{ id: 'test.other.changed', title: 'Changed' }],
      }),
    ).toThrow('test.other.changed');
    expect(registry.skins.get('test.skin')).toBe(registeredSkin);
    expect(registry.customIcons.get('TestIcon')).toBe('M2 2');
    expect(registry.customIconOwners.get('TestIcon')).toBe('spotify');
    expect(registry.mediaSources.get('test.source')?.plugin).toBe('spotify');
    expect(registry.actionsByPlugin()).toEqual([
      { plugin: spotify, actions: [registry.actions.get('test.play')] },
    ]);
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

  it('attributes variable/event APIs to their plugin and passes optional action context', async () => {
    const registry = await import('./registry');
    const { VariableStore } = await import('../automation/variables');
    const variables = new VariableStore();
    const registeredEvents: import('./contracts').EventDef[] = [];
    const emitted: unknown[][] = [];
    const stopRuntime = registry.setRegistryRuntime({
      variables,
      registerEvent: (event) => registeredEvents.push(event),
      emitEvent: async (...args) => {
        emitted.push(args);
      },
    });
    let api!: import('./contracts').PluginApi;
    const actionContexts: (import('./contracts').ActionContext | undefined)[] = [];
    registry.install({
      id: 'counter',
      title: 'Counter',
      setup: (pluginApi) => {
        api = pluginApi;
        api.registerVariable({
          id: 'counter.value',
          name: 'count',
          type: 'integer',
          initialValue: 0,
          persistent: true,
          readOnly: false,
        });
        api.registerEvent({ id: 'counter.changed', title: 'Counter changed' });
        api.registerEvent({
          id: 'counter.options',
          title: 'Counter options',
          parameterSuggestions: [{ value: 'counter.value', label: 'Count', plugin: 'counter' }],
        });
        api.registerAction({
          id: 'counter.increment',
          title: 'Increment',
          bindableVariable: () => 'counter.value',
          run: async (_args, context) => {
            actionContexts.push(context);
            await api.setVariable('counter.value', 1);
          },
        });
        api.registerAction({ id: 'counter.legacy', title: 'Legacy', run: (args) => args.value });
      },
    });
    const changes: unknown[] = [];
    const stopVariable = api.subscribeVariable('counter.value', (change) => changes.push(change));
    await registry.runAction(
      { id: 'counter.increment' },
      {
        signal: new AbortController().signal,
        runId: 'r1',
        controlId: 'b',
        itemId: 'i1',
        trigger: 'press',
        sourceStateId: 'state-1',
        getVariable: () => undefined,
        setVariable: async () => false,
        getVariant: () => undefined,
        setVariant: async () => {},
        emitEvent: async () => {},
        runSteps: async () => {},
      },
    );
    expect(variables.getValue('counter.value')).toBe(1);
    expect(changes).toEqual([{ id: 'counter.value', oldValue: 0, value: 1, type: 'integer' }]);
    expect(registry.actions.get('counter.increment')?.plugin).toBe('counter');
    expect(
      api.listVariables().find((record) => record.definition.id === 'counter.value')?.value,
    ).toBe(1);
    expect(registry.actions.get('counter.increment')?.bindableVariable?.({})).toBe('counter.value');
    const variableEvent = registry
      .registeredEvents(api.listVariables())
      .find((event) => event.id === 'variables.changed');
    expect(typeof variableEvent?.parameterSuggestions).toBe('function');
    expect(
      (variableEvent?.parameterSuggestions as () => { value: string; label: string }[])(),
    ).toEqual([{ value: 'counter.value', label: 'count', plugin: 'counter' }]);
    expect(registeredEvents).toEqual([
      { id: 'counter.changed', title: 'Counter changed', plugin: 'counter' },
      {
        id: 'counter.options',
        title: 'Counter options',
        parameterSuggestions: [{ value: 'counter.value', label: 'Count', plugin: 'counter' }],
        plugin: 'counter',
      },
    ]);
    expect(actionContexts[0]?.runId).toBe('r1');
    await api.emitEvent('counter.changed', 'count', { value: 1 });
    expect(emitted).toEqual([['counter.changed', 'count', { value: 1 }]]);
    expect(await registry.runAction({ id: 'counter.legacy', args: { value: 'ok' } })).toBe('ok');
    expect(
      registry.suggestionsOf(
        {
          key: 'target',
          label: 'Target',
          type: 'select',
          suggestions: (args) => [{ value: String(args?.target), label: 'Target' }],
        },
        { target: 'system' },
      ),
    ).toEqual([{ value: 'system', label: 'Target' }]);
    stopVariable();
    stopRuntime();
  });

  it('passes media-source and variable owners through core parameter suggestions', async () => {
    const registry = await import('./registry');
    const { corePlugin } = await import('../../plugins/core');
    const { settings } = await import('../settings/state.svelte');
    const { DEFAULTS } = await import('../settings/defaults');
    registry.install(corePlugin);
    registry.install({
      id: 'fixture-provider',
      title: 'Fixture Provider',
      setup: (api) => {
        api.registerMediaSource({
          id: 'fixture-provider.media',
          title: 'Fixture media',
          command: async () => {},
        });
        api.registerVariable({
          id: 'fixture-provider.count',
          name: 'Fixture count',
          type: 'integer',
          initialValue: 0,
          persistent: false,
          readOnly: false,
        });
      },
    });

    const sourceParam = registry.actions.get('media.prev')?.params?.[0];
    const variableParam = registry.actions.get('variable.set')?.params?.[0];
    expect(
      registry
        .suggestionsOf(sourceParam!)
        ?.find((option) => option.value === 'fixture-provider.media')?.plugin,
    ).toBe('fixture-provider');
    expect(
      registry
        .suggestionsOf(variableParam!)
        ?.find((option) => option.value === 'fixture-provider.count')?.plugin,
    ).toBe('fixture-provider');

    settings.deck.pages = [
      { ...structuredClone(DEFAULTS.deck.pages[0]), id: 'page-alpha', name: 'Alpha' },
      { ...structuredClone(DEFAULTS.deck.pages[0]), id: 'page-beta', name: 'Beta' },
    ];
    const gotoParam = registry.actions.get('page.goto')?.params?.[0];
    expect(registry.suggestionsOf(gotoParam!)).toEqual([
      { value: 'page-alpha', label: 'Alpha' },
      { value: 'page-beta', label: 'Beta' },
    ]);
    const pageEvent = registry.registeredEvents().find((event) => event.id === 'page.changed');
    expect(pageEvent?.title).toBe('Page changed');
    expect((pageEvent?.parameterSuggestions as () => { value: string; label: string }[])()).toEqual(
      [
        { value: 'page-alpha', label: 'Alpha' },
        { value: 'page-beta', label: 'Beta' },
      ],
    );
    settings.deck.pages[0].name = 'Renamed alpha';
    expect((gotoParam?.suggestions as () => { value: string; label: string }[])()).toEqual([
      { value: 'page-alpha', label: 'Renamed alpha' },
      { value: 'page-beta', label: 'Beta' },
    ]);
  });
});

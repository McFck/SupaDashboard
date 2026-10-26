import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { actions, install, skins } from '../features/plugins/registry';
import type { ActionContext } from '../features/plugins/contracts';
import { settings, serializeSettings } from '../features/settings/state.svelte';
import type { Page } from '../features/settings/schema';
import { captureTrigger } from '../features/automation/scenario-runner';
import { mediaSourceKey } from '../features/media/content';
import {
  acceptRuntimeSnapshot,
  AutomationRuntime,
  bootRuntime,
  runtimeView,
  stopRuntime,
} from './runtime.svelte';
import type { ControlConfig } from '../features/controls/model';
import type { Trigger } from '../features/automation/scenario';

const priorSettings = structuredClone(settings);
const page = (id: string): Page => ({
  ...structuredClone(priorSettings.deck.pages[0]),
  id,
  name: id,
  items: [],
});
const control = (): ControlConfig => ({
  id: 'runtime-test',
  name: 'Test',
  type: 'button',
  variants: [{ id: 'off', label: 'Off' }],
  scenario: {
    triggers: {
      press: { steps: [{ id: 'run', kind: 'action', action: { id: 'test.action' } }] },
      release: { steps: [{ id: 'release', kind: 'action', action: { id: 'test.release' } }] },
    },
    events: [],
  },
});
const packet = (controlConfig: ControlConfig, trigger: Trigger = 'press') =>
  captureTrigger(controlConfig, 'item', trigger, `${trigger}-${Math.random()}`, 'off')!;
let runtime: AutomationRuntime | undefined;

afterEach(async () => {
  await stopRuntime();
  await runtime?.dispose();
  runtime = undefined;
  Object.assign(settings, structuredClone(priorSettings));
  actions.delete('test.action');
  actions.delete('test.release');
  actions.delete('test.pull');
  actions.delete('test.page-cycle');
  actions.delete('page.next');
  actions.delete('page.prev');
  actions.delete('page.goto');
  const skin = skins.get('runtime-skin');
  if (skin) skins.set(skin.id, { ...skin, runtime: undefined });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('automation runtime', () => {
  it('steps relative states for migrated next/prev pulls', async () => {
    const config = control();
    config.variants = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ];
    settings.controls = [config];
    settings.variants[config.id] = 0;
    runtime = new AutomationRuntime();
    runtime.setState(config.id, 'next');
    expect(settings.variants[config.id]).toBe(1);
    runtime.setState(config.id, 'prev');
    runtime.setState(config.id, 'prev');
    expect(settings.variants[config.id]).toBe(2);
    runtime.setState(config.id, 'b');
    expect(settings.variants[config.id]).toBe(1);
    expect(() => runtime!.setState(config.id, 'missing')).toThrow();
  });

  it('routes owner-only media commands by global control id and resets after source edits', async () => {
    const config = {
      ...control(),
      type: 'media',
      options: {
        sources: [
          { kind: 'url', value: 'https://example.test/one.png' },
          { kind: 'url', value: 'https://example.test/two.png' },
        ],
        loop: false,
      },
    };
    const web = {
      ...control(),
      id: 'web-runtime',
      type: 'web',
      options: { url: 'https://example.test', zoom: 100 },
    };
    const pageA = page('page-1'),
      pageB = page('page-2');
    settings.deck.pages = [pageA, pageB];
    settings.deck.activePage = pageA.id;
    pageB.items.push({ id: 'web-runtime-item', control: web.id, x: 0, y: 0, w: 3, h: 2 });
    settings.skinLayouts = {
      subway: {
        [pageB.id]: { main: [{ id: 'media-item', control: config.id, x: 0, y: 0, w: 2, h: 2 }] },
      },
    };
    settings.controls = [config, web];
    runtime = new AutomationRuntime();
    runtime.reconcile(settings.controls);
    const saved = serializeSettings();
    const firstSource = mediaSourceKey({ kind: 'url', value: 'https://example.test/one.png' });
    runtime.rememberVideoPosition(config.id, firstSource, 12.5);
    expect(runtime.videoPosition(config.id, firstSource)).toBe(12.5);
    expect(get(runtime.snapshots).content[config.id]).toBeUndefined();

    expect(runtime.contentCommand(config.id, 'next')).toBe(true);
    expect(runtime.videoPosition(config.id, firstSource)).toBeUndefined();
    expect(get(runtime.snapshots).content[config.id]).toEqual({ slide: 1, reload: 0 });
    expect(runtime.contentCommand(config.id, 'next')).toBe(false);
    expect(runtime.contentCommand(config.id, 'prev')).toBe(true);
    expect(runtime.contentCommand(config.id, 'goto', 1)).toBe(true);
    expect(runtime.contentCommand(config.id, 'goto', 1)).toBe(false);
    expect(() => runtime!.contentCommand(config.id, 'goto', 2)).toThrow(
      'Media slide is unavailable',
    );
    expect(runtime.contentCommand(web.id, 'reload')).toBe(true);
    expect(get(runtime.snapshots).content[web.id]).toEqual({ slide: 0, reload: 1 });
    expect(runtime.contentCommand(web.id, 'reload')).toBe(true);
    expect(get(runtime.snapshots).content[web.id]?.reload).toBe(2);
    expect(serializeSettings()).toBe(saved);

    config.options.loop = true;
    expect(runtime.contentCommand(config.id, 'next')).toBe(true);
    expect(get(runtime.snapshots).content[config.id]?.slide).toBe(0);
    config.options.sources = [{ kind: 'url', value: 'https://example.test/replaced.png' }];
    runtime.reconcile(settings.controls);
    expect(get(runtime.snapshots).content[config.id]).toEqual({ slide: 0, reload: 0 });

    await runtime.dispose();
    runtime = new AutomationRuntime({ owner: false });
    expect(() => runtime!.contentCommand(config.id, 'goto', 0)).toThrow(
      'Content runtime is unavailable',
    );
  });

  it('keeps the selected media source when an unrelated source changes or the list reorders', () => {
    const sources = [
      { id: 'a', kind: 'url' as const, value: 'https://example.test/a.png' },
      { id: 'b', kind: 'url' as const, value: 'https://example.test/b.mp4' },
      { id: 'c', kind: 'url' as const, value: 'https://example.test/c.gif' },
    ];
    const config = { ...control(), type: 'media', options: { sources } };
    const active = page('media-active');
    active.items.push({ id: 'media-item', control: config.id, x: 0, y: 0, w: 2, h: 2 });
    settings.deck.pages = [active];
    settings.deck.activePage = active.id;
    settings.controls = [config];
    runtime = new AutomationRuntime();
    runtime.reconcile(settings.controls);
    runtime.contentCommand(config.id, 'goto', 1);
    const currentKey = mediaSourceKey({ kind: 'url', value: sources[1].value });
    runtime.rememberVideoPosition(config.id, currentKey, 7.5);

    config.options.sources[0].value = 'https://example.test/changed.png';
    runtime.reconcile(settings.controls);
    expect(get(runtime.snapshots).content[config.id]?.slide).toBe(1);
    expect(runtime.videoPosition(config.id, currentKey)).toBe(7.5);

    config.options.sources = [sources[2], sources[0], sources[1]];
    runtime.reconcile(settings.controls);
    expect(get(runtime.snapshots).content[config.id]?.slide).toBe(2);
    expect(runtime.videoPosition(config.id, currentKey)).toBe(7.5);
  });

  it('dispatches one configured pull action and keeps an unbound pull quiet', async () => {
    const config = control();
    config.scenario!.triggers.swipeRight = {
      steps: [{ id: 'pull', kind: 'action', action: { id: 'test.pull' } }],
    };
    settings.controls = [config];
    const calls: string[] = [],
      failures: unknown[] = [];
    actions.set('test.pull', {
      id: 'test.pull',
      title: 'Pull',
      run: () => {
        calls.push('pull');
      },
    });
    runtime = new AutomationRuntime({ onFailure: (failure) => failures.push(failure) });
    await expect(runtime.dispatchTrigger(config.id, 'item', 'swipeRight')).resolves.toMatchObject({
      status: 'completed',
    });
    await expect(runtime.dispatchTrigger(config.id, 'item', 'swipeLeft')).resolves.toMatchObject({
      status: 'completed',
    });
    expect(calls).toEqual(['pull']);
    expect(failures).toEqual([]);
  });

  it('serializes each control and trigger lane while independent releases continue', async () => {
    const config = control();
    settings.controls = [config];
    const trace: string[] = [];
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    actions.set('test.action', {
      id: 'test.action',
      title: 'Test',
      run: async (args) => {
        trace.push(String(args.id));
        if (args.id === 'first') await blocked;
      },
    });
    actions.set('test.release', {
      id: 'test.release',
      title: 'Release',
      run: () => {
        trace.push('release');
      },
    });
    config.scenario!.triggers.press!.steps = [
      { id: 'first', kind: 'action', action: { id: 'test.action', args: { id: 'first' } } },
      { id: 'second', kind: 'action', action: { id: 'test.action', args: { id: 'second' } } },
    ];
    runtime = new AutomationRuntime();
    const first = runtime.dispatch(packet(config));
    const second = runtime.dispatch(packet(config));
    const release = runtime.dispatch(packet(config, 'release'));
    await Promise.resolve();
    expect(trace).toEqual(['first', 'release']);
    unblock();
    await Promise.all([first, second, release]);
    expect(trace).toEqual(['first', 'release', 'second', 'first', 'second']);
    expect(get(runtime.snapshots).busy).toEqual({});
  });

  it('limits pending work to 32 per lane and stop resolves pending packets', async () => {
    const config = control();
    settings.controls = [config];
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    actions.set('test.action', { id: 'test.action', title: 'Test', run: () => blocked });
    runtime = new AutomationRuntime();
    const running = runtime.dispatch(packet(config));
    const queued = Array.from({ length: 32 }, () => runtime!.dispatch(packet(config)));
    const excess = await runtime.dispatch(packet(config));
    expect(excess.status).toBe('rejected');
    const stopped = runtime.stopControl(config.id);
    expect((await Promise.all(queued)).every((result) => result.status === 'cancelled')).toBe(true);
    unblock();
    await Promise.all([running, stopped]);
    expect(get(runtime.snapshots).busy).toEqual({});
  });

  it('only cancels for executable config changes and cancels removed controls', async () => {
    const config = control();
    settings.controls = [config];
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    actions.set('test.action', { id: 'test.action', title: 'Test', run: () => blocked });
    runtime = new AutomationRuntime();
    const run = runtime.dispatch(packet(config));
    await Promise.resolve();
    config.name = 'Renamed';
    runtime.reconcile([config]);
    expect(get(runtime.snapshots).busy['runtime-test']).toBe(1);
    runtime.reconcile([]);
    await expect(run).resolves.toEqual({ status: 'cancelled' });
    unblock();
    expect(get(runtime.snapshots).busy).toEqual({});
  });

  it('keeps owner page selection runtime-only and follows a deleted active page once', async () => {
    settings.deck.pages = [
      structuredClone(priorSettings.deck.pages[0]),
      { ...structuredClone(priorSettings.deck.pages[0]), id: 'page-2', name: 'Page 2' },
      { ...structuredClone(priorSettings.deck.pages[0]), id: 'page-3', name: 'Page 3' },
    ];
    settings.deck.activePage = 'page-2';
    runtime = new AutomationRuntime();
    await tick();
    expect(runtime.changePage('missing')).toBe(false);
    expect(runtime.changePage('page-2')).toBe(false);
    expect(runtime.changePage('page-3')).toBe(true);
    expect(get(runtime.snapshots)).toMatchObject({ owner: true, activePage: 'page-3' });
    expect(JSON.parse(serializeSettings()).deck.activePage).toBe('page-1');
    expect(runtime.changePage('page-2')).toBe(true);
    settings.deck.pages = settings.deck.pages.filter((page) => page.id !== 'page-2');
    runtime.reconcilePages();
    await tick();
    expect(settings.deck.activePage).toBe('page-3');
    const writesBefore = serializeSettings();
    acceptRuntimeSnapshot(
      { activePage: 'page-1', variables: { revision: 0, records: {} }, busy: {} },
      1000,
    );
    expect(settings.deck.activePage).toBe('page-1');
    expect(get(runtimeView)).toMatchObject({ owner: false, activePage: 'page-1' });
    expect(serializeSettings()).toBe(writesBefore);
  });

  it('publishes page.changed only for effective owner changes with the transition payload', async () => {
    settings.deck.pages = [page('page-1'), page('page-2')];
    settings.deck.activePage = 'page-1';
    const listener = control();
    listener.scenario!.events = [
      { id: 'page-listener', eventId: 'page.changed', list: { steps: [] } },
    ];
    settings.controls = [listener];
    runtime = new AutomationRuntime();
    const dispatch = vi.spyOn(runtime, 'dispatch').mockResolvedValue({ status: 'completed' });

    expect(runtime.changePage('page-2', 'dot')).toBe(true);
    expect(runtime.changePage('page-2', 'action')).toBe(false);
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0].event).toEqual({
      id: 'page.changed',
      parameter: 'page-2',
      payload: { previousPage: 'page-1', page: 'page-2', reason: 'dot' },
    });

    settings.deck.pages[1].name = 'Renamed';
    settings.deck.pages = [...settings.deck.pages].reverse();
    await tick();
    expect(dispatch).toHaveBeenCalledOnce();
    const follower = new AutomationRuntime({ owner: false });
    expect(follower.changePage('page-1', 'dot')).toBe(false);
    await follower.dispose();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('detaches page event dispatch and stops a listener navigation cycle', async () => {
    settings.deck.pages = [page('page-1'), page('page-2'), page('page-3')];
    settings.deck.activePage = 'page-1';
    const listener = control();
    listener.scenario!.events = [
      {
        id: 'page-listener',
        eventId: 'page.changed',
        list: { steps: [{ id: 'cycle', kind: 'action', action: { id: 'test.page-cycle' } }] },
      },
    ];
    settings.controls = [listener];
    const calls: unknown[] = [],
      failures: unknown[] = [];
    actions.set('test.page-cycle', {
      id: 'test.page-cycle',
      title: 'Navigate',
      run: (_args, context) => {
        calls.push(context?.eventAncestry);
        runtime!.changePage('page-3', 'action', context?.eventAncestry);
      },
    });
    runtime = new AutomationRuntime({ onFailure: (failure) => failures.push(failure) });

    expect(runtime.changePage('page-2', 'dot')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(settings.deck.activePage).toBe('page-3');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ depth: 1, listeners: ['runtime-test\u0000page-listener'] });
    expect(failures).toHaveLength(1);
  });

  it('runs next, previous and goto only through a live owner and rejects invalid requests', async () => {
    const { corePlugin } = await import('../plugins/core');
    const { suggestionsOf } = await import('../features/plugins/registry');
    const { VariableStore } = await import('../features/automation/variables');
    install(corePlugin);
    settings.deck.pages = [page('page-1'), page('page-2'), page('page-3')];
    settings.deck.activePage = 'page-1';
    const sources = [
      { kind: 'url' as const, value: 'https://example.test/a.png' },
      { kind: 'url' as const, value: 'https://example.test/b.png' },
      { kind: 'url' as const, value: 'https://example.test/c.png' },
    ];
    const self = {
      ...control(),
      id: 'media-self',
      name: 'Self media',
      type: 'media',
      options: { sources, loop: false },
    };
    const other = {
      ...control(),
      id: 'media-other',
      name: 'Other media',
      type: 'media',
      options: { sources, loop: true },
    };
    settings.deck.pages[0].items.push({
      id: 'self-item',
      control: self.id,
      x: 0,
      y: 0,
      w: 2,
      h: 2,
    });
    settings.skinLayouts = {
      subway: {
        'page-2': { main: [{ id: 'other-item', control: other.id, x: 0, y: 0, w: 2, h: 2 }] },
      },
    };
    settings.controls = [self, other];
    const owner = await bootRuntime({ variables: new VariableStore() });
    runtime = owner.runtime;
    const context = {
      signal: new AbortController().signal,
      eventAncestry: { depth: 0, listeners: [] },
    } as unknown as ActionContext;
    const next = actions.get('page.next')!,
      prev = actions.get('page.prev')!,
      goTo = actions.get('page.goto')!;

    await next.run({}, context);
    expect(settings.deck.activePage).toBe('page-2');
    await goTo.run({ page: 'page-3' }, context);
    expect(settings.deck.activePage).toBe('page-3');
    await prev.run({}, context);
    expect(settings.deck.activePage).toBe('page-2');
    await expect(
      Promise.resolve().then(() => goTo.run({ page: 'missing' }, context)),
    ).rejects.toThrow('Page is unavailable');
    expect(settings.deck.activePage).toBe('page-2');

    const mediaNext = actions.get('media.next')!,
      mediaPrev = actions.get('media.prev')!,
      mediaGoto = actions.get('media.goto')!;
    const mediaContext = { ...context, controlId: self.id };
    const mediaTarget = mediaNext.params!.find((param) => param.key === 'target')!;
    expect((suggestionsOf(mediaTarget) ?? []).map((option) => option.value)).toEqual([
      'self',
      'media-self',
      'media-other',
    ]);
    await mediaNext.run({ target: 'self', source: 'system' }, mediaContext);
    expect(get(runtime.snapshots).content[self.id]?.slide).toBe(1);
    await mediaNext.run({ target: other.id, source: 'system' }, mediaContext);
    expect(get(runtime.snapshots).content[other.id]?.slide).toBe(1);
    await mediaPrev.run({ target: other.id, source: 'system' }, mediaContext);
    expect(get(runtime.snapshots).content[other.id]?.slide).toBe(0);
    await mediaGoto.run({ target: other.id, index: 2 }, mediaContext);
    expect(get(runtime.snapshots).content[other.id]?.slide).toBe(2);
    await mediaNext.run({ target: other.id, source: 'system' }, mediaContext);
    expect(get(runtime.snapshots).content[other.id]?.slide).toBe(0);
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      Promise.resolve().then(() => next.run({}, { ...context, signal: aborted.signal })),
    ).rejects.toThrow('runtime is unavailable');

    await stopRuntime();
    runtime = undefined;
    const follower = await bootRuntime({ variables: new VariableStore(), owner: false });
    runtime = follower.runtime;
    await expect(Promise.resolve().then(() => next.run({}, context))).rejects.toThrow(
      'runtime is unavailable',
    );
    await expect(
      Promise.resolve().then(() => mediaNext.run({ target: self.id }, mediaContext)),
    ).rejects.toThrow('Content runtime is unavailable');
  });

  it('runs skin setup only for an owner, resolves config and keeps view/state outside settings history', async () => {
    const skinId = 'runtime-skin';
    const observed: unknown[] = [];
    const cleanup = vi.fn();
    let hookContext!: import('../features/skins/definition').SkinRuntimeContext;
    install({
      id: 'runtime-skin-plugin',
      title: 'Runtime skin fixture',
      setup: (api) =>
        api.registerSkin({
          id: skinId,
          title: 'Runtime skin',
          component: {} as import('svelte').Component,
          slots: [{ id: 'main', style: 'region', kind: 'grid', grid: 'page' }],
          views: [
            { id: 'display', title: 'Display', slots: ['main'] },
            { id: 'cab', title: 'Cab', slots: ['main'] },
          ],
          defaultView: 'display',
          settings: [{ key: 'enabled', label: 'Enabled', type: 'boolean', default: false }],
          state: [{ key: 'configured', type: 'boolean', initialValue: false, persistent: true }],
          events: [{ id: `${skinId}.changed`, title: 'Changed' }],
          runtime: (context) => {
            hookContext = context;
            const stop = context.config.subscribe((config) => {
              observed.push(config.enabled);
              void context.setState('configured', config.enabled === true);
            });
            return () => {
              stop();
              cleanup();
            };
          },
        }),
    });
    settings.skinSettings[skinId] = { enabled: true, future: '保持' };
    const before = serializeSettings();
    runtime = new AutomationRuntime();
    await tick();
    expect(observed).toEqual([true]);
    expect(runtime.variables.getValue(`${skinId}.configured`)).toBe(true);
    expect(runtime.variables.getValue(`${skinId}.view`)).toBe('display');
    expect(serializeSettings()).toBe(before);

    settings.skinSettings = {
      ...settings.skinSettings,
      [skinId]: { enabled: false, future: '保持' },
    };
    runtime.updateSkinConfig(skinId, settings.skinSettings[skinId]);
    await tick();
    expect(observed).toEqual([true, false]);
    expect(runtime.variables.getValue(`${skinId}.configured`)).toBe(false);

    const ancestry = { depth: 2, listeners: ['button\u0000change'] };
    const emit = vi.spyOn(runtime, 'emitEvent').mockResolvedValue();
    await runtime.setSkinView(skinId, 'cab', ancestry);
    await runtime.setSkinState(skinId, 'configured', true, ancestry);
    await hookContext.emitEvent(`${skinId}.changed`, 'fixture', { ok: true }, ancestry);
    expect(runtime.variables.getValue(`${skinId}.view`)).toBe('cab');
    expect(
      runtime.variables
        .serializePersistent()
        .records.find((record) => record.definition.id === `${skinId}.configured`)?.value,
    ).toBe(true);
    expect(
      runtime.variables
        .serializePersistent()
        .records.some((record) => record.definition.id === `${skinId}.view`),
    ).toBe(false);
    expect(emit.mock.calls).toContainEqual([
      'variables.changed',
      `${skinId}.configured`,
      expect.any(Object),
      ancestry,
    ]);
    expect(emit).toHaveBeenCalledWith(`${skinId}.changed`, 'fixture', { ok: true }, ancestry);

    await runtime.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
    const variables = runtime.variables;
    skins.set(skinId, { ...skins.get(skinId)!, runtime: undefined });
    variables.set(`${skinId}.view`, 'missing-view', 'runtime-skin-plugin');
    runtime = new AutomationRuntime({ variables });
    expect(runtime.variables.getValue(`${skinId}.view`)).toBe('display');
    await runtime.dispose();
    runtime = new AutomationRuntime({ owner: false });
    expect(observed).toEqual([true, false]);
    expect(() => runtime!.setSkinState(skinId, 'configured', false)).toThrow(
      'Skin runtime is unavailable',
    );
  });
});

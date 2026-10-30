import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { actions, install, applets } from '../../features/plugins/registry';
import type { ActionContext } from '../../features/plugins/contracts';
import { settings, serializeSettings } from '../../features/settings/state.svelte';
import type { Page, Settings } from '../../features/settings/schema';
import { captureTrigger } from '../../features/automation/capture';
import { mediaSourceKey } from '../../features/media/content';
import { VariableStore } from '../../features/automation/variables';
import { acceptRuntimeSnapshot } from './client';
import { RuntimeSession } from './session.svelte';
import { runtimeView } from './state';
import type { ControlConfig } from '../../features/controls/model';
import type { Trigger } from '../../features/automation/scenario';

const remote = vi.hoisted(() => ({
  listener: undefined as ((next: Settings) => void) | undefined,
}));
vi.mock('../../features/settings/persistence.svelte', () => ({
  onRemoteSettings(listener: (next: Settings) => void) {
    remote.listener = listener;
    return () => {
      remote.listener = undefined;
    };
  },
}));

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
let runtime: RuntimeSession | undefined;

afterEach(async () => {
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
  const applet = applets.get('runtime-applet');
  if (applet) applets.set(applet.id, { ...applet, start: undefined });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('automation runtime', () => {
  it('publishes remote content only after controls and placements have both been assigned', async () => {
    vi.useFakeTimers();
    settings.deck.pages = [page('page-1')];
    settings.deck.activePage = 'page-1';
    settings.controls = [];
    runtime = new RuntimeSession();
    await tick();
    const next = structuredClone(settings);
    next.controls = [
      {
        ...control(),
        type: 'media',
        options: {
          sources: [{ kind: 'url', value: 'https://example.test/a.png' }],
        },
      },
    ];
    next.deck.pages[0].items = [
      { id: 'media', control: next.controls[0].id, x: 0, y: 0, w: 1, h: 1 },
    ];
    const snapshots: unknown[] = [];
    const stop = runtime.snapshots.subscribe((snapshot) => snapshots.push(snapshot));
    snapshots.length = 0;
    try {
      remote.listener!(next);
      expect(snapshots).toEqual([]);
      Object.assign(settings, next);
      runtime.reconcile(settings.controls);
      expect(snapshots).toHaveLength(1);
      expect(runtime.contentCommand(next.controls[0].id, 'goto', 0)).toBe(false);
    } finally {
      stop();
    }
  });

  it('runs applet quick actions only in a live owner with runner context', async () => {
    let received: ActionContext | undefined;
    actions.set('test.action', {
      id: 'test.action',
      title: 'Quick action',
      run: (_args, context) => {
        received = context;
      },
    });
    runtime = new RuntimeSession();

    await expect(runtime.dispatchQuickAction({ id: 'test.action' })).resolves.toEqual({
      status: 'completed',
    });
    expect(received).toMatchObject({ controlId: '' });
    expect(received?.signal.aborted).toBe(false);

    actions.set('test.release', {
      id: 'test.release',
      title: 'Endless quick action',
      run: () => new Promise(() => {}),
    });
    const endless = runtime.dispatchQuickAction({ id: 'test.release' });
    await runtime.dispose();
    await expect(endless).resolves.toEqual({ status: 'cancelled' });
    await expect(runtime.dispatchQuickAction({ id: 'test.action' })).resolves.toEqual({
      status: 'rejected',
    });
  });

  it('keeps clock ticks out of persistence while saving edits, renames and persistence removal', async () => {
    vi.useFakeTimers();
    const variables = new VariableStore();
    variables.define(
      {
        id: 'clock.time',
        name: 'clock.time',
        type: 'string',
        owner: 'core',
        persistent: false,
        readOnly: true,
        initialValue: '',
      },
      'core',
    );
    variables.createUser({ id: 'saved', name: 'Saved', type: 'integer', initialValue: 1 });
    const saved: ReturnType<VariableStore['serializePersistent']>[] = [];
    runtime = new RuntimeSession({
      variables,
      persistence: {
        save: async (value) => {
          saved.push(value);
        },
      },
    });
    await vi.advanceTimersByTimeAsync(250);
    saved.length = 0;
    const initialTime = variables.getValue('clock.time');
    await vi.advanceTimersByTimeAsync(3000);
    expect(variables.getValue('clock.time')).not.toBe(initialTime);
    expect(saved).toEqual([]);
    variables.set('saved', 2);
    await vi.advanceTimersByTimeAsync(250);
    expect(saved.at(-1)?.records.find((record) => record.definition.id === 'saved')?.value).toBe(2);
    variables.rename('saved', 'Renamed');
    await vi.advanceTimersByTimeAsync(250);
    expect(
      saved.at(-1)?.records.find((record) => record.definition.id === 'saved')?.definition.name,
    ).toBe('Renamed');
    variables.setPersistent('saved', false);
    await vi.advanceTimersByTimeAsync(250);
    expect(saved.at(-1)?.records.some((record) => record.definition.id === 'saved')).toBe(false);
    const count = saved.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(saved).toHaveLength(count);
  });

  it('stops the clock after owner disposal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    const variables = new VariableStore();
    variables.define(
      {
        id: 'clock.time',
        name: 'clock.time',
        type: 'string',
        owner: 'core',
        persistent: false,
        readOnly: true,
        initialValue: 'not-started',
      },
      'core',
    );
    runtime = new RuntimeSession({ variables });
    const initial = variables.getValue('clock.time');
    expect(initial).not.toBe('not-started');
    await vi.advanceTimersByTimeAsync(1000);
    expect(variables.getValue('clock.time')).not.toBe(initial);
    await runtime.dispose();
    const stopped = variables.snapshot();
    await vi.advanceTimersByTimeAsync(1000);
    expect(variables.snapshot()).toEqual(stopped);
  });

  it('steps relative states for migrated next/prev pulls', async () => {
    const config = control();
    config.variants = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ];
    settings.controls = [config];
    settings.variants[config.id] = 0;
    runtime = new RuntimeSession();
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
    const pageA = page('page-1'),
      pageB = page('page-2');
    settings.deck.pages = [pageA, pageB];
    settings.deck.activePage = pageA.id;
    settings.appletLayouts = {
      subway: {
        [pageB.id]: { main: [{ id: 'media-item', control: config.id, x: 0, y: 0, w: 2, h: 2 }] },
      },
    };
    settings.controls = [config];
    runtime = new RuntimeSession();
    runtime.reconcile(settings.controls);
    expect(runtime.contentCommand(config.id, 'next')).toBe(true);
    expect(get(runtime.snapshots).content[config.id]).toEqual({ slide: 1, reload: 0 });
    config.options.sources = [{ kind: 'url', value: 'https://example.test/replaced.png' }];
    runtime.reconcile(settings.controls);
    expect(get(runtime.snapshots).content[config.id]).toEqual({ slide: 0, reload: 0 });

    await runtime.dispose();
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
    runtime = new RuntimeSession();
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

  it('only cancels for executable config changes and cancels removed controls', async () => {
    const config = control();
    settings.controls = [config];
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    actions.set('test.action', { id: 'test.action', title: 'Test', run: () => blocked });
    runtime = new RuntimeSession();
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
    runtime = new RuntimeSession();
    await tick();
    expect(runtime.changePage('missing', 'action')).toBe(false);
    expect(runtime.changePage('page-2', 'action')).toBe(false);
    expect(runtime.changePage('page-3', 'action')).toBe(true);
    expect(get(runtime.snapshots)).toMatchObject({ owner: true, activePage: 'page-3' });
    expect(JSON.parse(serializeSettings()).deck.activePage).toBe('page-1');
    expect(runtime.changePage('page-2', 'action')).toBe(true);
    settings.deck.pages = settings.deck.pages.filter((page) => page.id !== 'page-2');
    runtime.pages.reconcile(settings.deck.pages);
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
    runtime = new RuntimeSession();
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
    await runtime.dispose();
    expect(runtime.changePage('page-1', 'dot')).toBe(false);
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
    runtime = new RuntimeSession({ onFailure: (failure) => failures.push(failure) });

    expect(runtime.changePage('page-2', 'dot')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(settings.deck.activePage).toBe('page-3');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ depth: 1, listeners: ['runtime-test\u0000page-listener'] });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ kind: 'cycle' });
  });

  it('rejects page actions after owner disposal and goto for a missing page', async () => {
    const { corePlugin } = await import('../../plugins/core');
    install(corePlugin);
    settings.deck.pages = [page('page-1')];
    settings.deck.activePage = 'page-1';
    runtime = new RuntimeSession();
    const context = {
      signal: new AbortController().signal,
      eventAncestry: { depth: 0, listeners: [] },
    } as unknown as ActionContext;
    const next = actions.get('page.next')!;
    const goTo = actions.get('page.goto')!;
    await expect(
      Promise.resolve().then(() => goTo.run({ page: 'missing' }, context)),
    ).rejects.toThrow('Page is unavailable');
    await runtime.dispose();
    await expect(Promise.resolve().then(() => next.run({}, context))).rejects.toThrow(
      'runtime is unavailable',
    );
  });

  it('keeps applet view and state outside settings history', async () => {
    const appletId = 'runtime-applet';
    install({
      id: 'runtime-applet-plugin',
      title: 'Runtime applet fixture',
      setup: (api) =>
        api.registerApplet({
          id: appletId,
          title: 'Runtime applet',
          component: {} as import('svelte').Component,
          slots: [{ id: 'main', kind: 'grid', grid: 'page' }],
          views: [
            { id: 'display', title: 'Display' },
            { id: 'cab', title: 'Cab' },
          ],
          defaultView: 'display',
          settings: [{ key: 'enabled', label: 'Enabled', type: 'boolean', default: false }],
          state: [{ key: 'configured', type: 'boolean', initialValue: false, persistent: true }],
          events: [{ id: `${appletId}.changed`, title: 'Changed' }],
        }),
    });
    settings.appletSettings[appletId] = {
      shared: { enabled: true, future: '保持' },
      separate: false,
    };
    const before = serializeSettings();
    runtime = new RuntimeSession();
    await tick();
    expect(runtime.variables.getValue(`${appletId}.view`)).toBe('display');
    expect(serializeSettings()).toBe(before);

    await runtime.applets.setView(appletId, 'cab');
    runtime.variables.set(`${appletId}.configured`, true, 'runtime-applet-plugin');
    expect(runtime.variables.getValue(`${appletId}.view`)).toBe('cab');
    expect(
      runtime.variables
        .serializePersistent()
        .records.find((record) => record.definition.id === `${appletId}.configured`)?.value,
    ).toBe(true);
    expect(
      runtime.variables
        .serializePersistent()
        .records.some((record) => record.definition.id === `${appletId}.view`),
    ).toBe(false);
    expect(serializeSettings()).toBe(before);
  });
});

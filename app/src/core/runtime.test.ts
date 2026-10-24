import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { actions, install, type ActionContext } from './registry';
import { settings, serializeSettings } from './settings.svelte';
import { captureTrigger } from './scenario-runner';
import { acceptRuntimeSnapshot, AutomationRuntime, bootRuntime, runtimeView, stopRuntime } from './runtime.svelte';
import type { ControlConfig } from './controls';
import type { Trigger } from './scenario';

const priorSettings = structuredClone(settings);
const page = (id: string) => ({ ...structuredClone(priorSettings.deck.pages[0]), id, name: id, items: [] });
const control = (): ControlConfig => ({ id: 'runtime-test', name: 'Test', type: 'button', variants: [{ id: 'off', label: 'Off' }],
  scenario: { triggers: { press: { steps: [{ id: 'run', kind: 'action', action: { id: 'test.action' } }] },
    release: { steps: [{ id: 'release', kind: 'action', action: { id: 'test.release' } }] } }, events: [] } });
const packet = (controlConfig: ControlConfig, trigger: Trigger = 'press') => captureTrigger(controlConfig, 'item', trigger,
  `${trigger}-${Math.random()}`, 'off')!;
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('automation runtime', () => {
  it('steps relative states for migrated next/prev pulls', async () => {
    const config = control();
    config.variants = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
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

  it('dispatches one configured pull action and keeps an unbound pull quiet', async () => {
    const config = control();
    config.scenario!.triggers.swipeRight = { steps: [{ id: 'pull', kind: 'action', action: { id: 'test.pull' } }] };
    settings.controls = [config];
    const calls: string[] = [], failures: unknown[] = [];
    actions.set('test.pull', { id: 'test.pull', title: 'Pull', run: () => { calls.push('pull'); } });
    runtime = new AutomationRuntime({ onFailure: failure => failures.push(failure) });
    await expect(runtime.dispatchTrigger(config.id, 'item', 'swipeRight')).resolves.toMatchObject({ status: 'completed' });
    await expect(runtime.dispatchTrigger(config.id, 'item', 'swipeLeft')).resolves.toMatchObject({ status: 'completed' });
    expect(calls).toEqual(['pull']);
    expect(failures).toEqual([]);
  });

  it('serializes each control and trigger lane while independent releases continue', async () => {
    const config = control();
    settings.controls = [config];
    const trace: string[] = [];
    let unblock!: () => void;
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    actions.set('test.action', { id: 'test.action', title: 'Test', run: async args => {
      trace.push(String(args.id));
      if (args.id === 'first') await blocked;
    } });
    actions.set('test.release', { id: 'test.release', title: 'Release', run: () => { trace.push('release'); } });
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
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    actions.set('test.action', { id: 'test.action', title: 'Test', run: () => blocked });
    runtime = new AutomationRuntime();
    const running = runtime.dispatch(packet(config));
    const queued = Array.from({ length: 32 }, () => runtime!.dispatch(packet(config)));
    const excess = await runtime.dispatch(packet(config));
    expect(excess.status).toBe('rejected');
    const stopped = runtime.stopControl(config.id);
    expect((await Promise.all(queued)).every(result => result.status === 'cancelled')).toBe(true);
    unblock();
    await Promise.all([running, stopped]);
    expect(get(runtime.snapshots).busy).toEqual({});
  });

  it('only cancels for executable config changes and cancels removed controls', async () => {
    const config = control();
    settings.controls = [config];
    let unblock!: () => void;
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
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
    settings.deck.pages = [structuredClone(priorSettings.deck.pages[0]),
      { ...structuredClone(priorSettings.deck.pages[0]), id: 'page-2', name: 'Page 2' },
      { ...structuredClone(priorSettings.deck.pages[0]), id: 'page-3', name: 'Page 3' }];
    settings.deck.activePage = 'page-2';
    runtime = new AutomationRuntime();
    await tick();
    expect(runtime.changePage('missing')).toBe(false);
    expect(runtime.changePage('page-2')).toBe(false);
    expect(runtime.changePage('page-3')).toBe(true);
    expect(get(runtime.snapshots)).toMatchObject({ owner: true, activePage: 'page-3' });
    expect(JSON.parse(serializeSettings()).deck.activePage).toBe('page-1');
    expect(runtime.changePage('page-2')).toBe(true);
    settings.deck.pages = settings.deck.pages.filter(page => page.id !== 'page-2');
    runtime.reconcilePages();
    await tick();
    expect(settings.deck.activePage).toBe('page-3');
    const writesBefore = serializeSettings();
    acceptRuntimeSnapshot({ activePage: 'page-1', variables: { revision: 0, records: {} }, busy: {} }, 1000);
    expect(settings.deck.activePage).toBe('page-1');
    expect(get(runtimeView)).toMatchObject({ owner: false, activePage: 'page-1' });
    expect(serializeSettings()).toBe(writesBefore);
  });

  it('publishes page.changed only for effective owner changes with the transition payload', async () => {
    settings.deck.pages = [page('page-1'), page('page-2')];
    settings.deck.activePage = 'page-1';
    const listener = control();
    listener.scenario!.events = [{ id: 'page-listener', eventId: 'page.changed', list: { steps: [] } }];
    settings.controls = [listener];
    runtime = new AutomationRuntime();
    const dispatch = vi.spyOn(runtime, 'dispatch').mockResolvedValue({ status: 'completed' });

    expect(runtime.changePage('page-2', 'dot')).toBe(true);
    expect(runtime.changePage('page-2', 'auto')).toBe(false);
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0].event).toEqual({ id: 'page.changed', parameter: 'page-2',
      payload: { previousPage: 'page-1', page: 'page-2', reason: 'dot' } });

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
    listener.scenario!.events = [{ id: 'page-listener', eventId: 'page.changed', list: { steps: [
      { id: 'cycle', kind: 'action', action: { id: 'test.page-cycle' } },
    ] } }];
    settings.controls = [listener];
    const calls: unknown[] = [], failures: unknown[] = [];
    actions.set('test.page-cycle', { id: 'test.page-cycle', title: 'Navigate', run: (_args, context) => {
      calls.push(context?.eventAncestry);
      runtime!.changePage('page-3', 'action', context?.eventAncestry);
    } });
    runtime = new AutomationRuntime({ onFailure: failure => failures.push(failure) });

    expect(runtime.changePage('page-2', 'dot')).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(settings.deck.activePage).toBe('page-3');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ depth: 1, listeners: ['runtime-test\u0000page-listener'] });
    expect(failures).toHaveLength(1);
  });

  it('runs next, previous and goto only through a live owner and rejects invalid requests', async () => {
    const { corePlugin } = await import('../plugins/core');
    const { VariableStore } = await import('./variables');
    install(corePlugin);
    settings.deck.pages = [page('page-1'), page('page-2'), page('page-3')];
    settings.deck.activePage = 'page-1';
    const owner = await bootRuntime({ variables: new VariableStore() });
    runtime = owner.runtime;
    const context = { signal: new AbortController().signal, eventAncestry: { depth: 0, listeners: [] } } as unknown as ActionContext;
    const next = actions.get('page.next')!, prev = actions.get('page.prev')!, goTo = actions.get('page.goto')!;

    await next.run({}, context);
    expect(settings.deck.activePage).toBe('page-2');
    await goTo.run({ page: 'page-3' }, context);
    expect(settings.deck.activePage).toBe('page-3');
    await prev.run({}, context);
    expect(settings.deck.activePage).toBe('page-2');
    await expect(Promise.resolve().then(() => goTo.run({ page: 'missing' }, context))).rejects.toThrow('Page is unavailable');
    expect(settings.deck.activePage).toBe('page-2');
    const aborted = new AbortController();
    aborted.abort();
    await expect(Promise.resolve().then(() => next.run({}, { ...context, signal: aborted.signal }))).rejects.toThrow('runtime is unavailable');

    await stopRuntime();
    runtime = undefined;
    const follower = await bootRuntime({ variables: new VariableStore(), owner: false });
    runtime = follower.runtime;
    await expect(Promise.resolve().then(() => next.run({}, context))).rejects.toThrow('runtime is unavailable');
  });

  it('rotates on one owner timer, pauses through interaction and visibility, then clears on disable', async () => {
    vi.useFakeTimers();
    let visibilityChanged: (() => void) | undefined;
    const documentMock = { hidden: false,
      addEventListener: (_type: string, listener: unknown) => { visibilityChanged = listener as () => void; },
      removeEventListener: vi.fn() };
    vi.stubGlobal('document', documentMock);
    settings.deck.pages = [page('page-1'), page('page-2'), page('page-3')];
    settings.deck.activePage = 'page-1';
    settings.pageRotation.intervalSeconds = 5;
    runtime = new AutomationRuntime();
    await tick();
    expect(vi.getTimerCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(5_000);
    await tick();
    expect(settings.deck.activePage).toBe('page-2');
    await vi.advanceTimersByTimeAsync(5_000);
    await tick();
    expect(settings.deck.activePage).toBe('page-3');
    await vi.advanceTimersByTimeAsync(5_000);
    await tick();
    expect(settings.deck.activePage).toBe('page-1');

    runtime.setInteractionActive(true);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(settings.deck.activePage).toBe('page-1');
    runtime.setInteractionActive(false);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settings.deck.activePage).toBe('page-1');
    await vi.advanceTimersByTimeAsync(1);
    await tick();
    expect(settings.deck.activePage).toBe('page-2');

    documentMock.hidden = true;
    visibilityChanged?.();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(settings.deck.activePage).toBe('page-2');
    documentMock.hidden = false;
    visibilityChanged?.();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settings.deck.activePage).toBe('page-2');
    await vi.advanceTimersByTimeAsync(1);
    await tick();
    expect(settings.deck.activePage).toBe('page-3');

    settings.pageRotation.intervalSeconds = 0;
    await tick();
    runtime.setInteractionActive(true);
    runtime.setInteractionActive(false);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(settings.deck.activePage).toBe('page-3');
    await runtime.dispose();
    runtime = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });
});

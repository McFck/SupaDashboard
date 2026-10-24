import { isTauri } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { get, writable, type Readable } from 'svelte/store';
import { settings, onRemoteSettings, type Settings } from './settings.svelte';
import { controlById } from './settings.svelte';
import { effectiveVariant, stateIdAt } from './button-state';
import { EventRegistry, listenerKey, type EventTarget } from './events';
import { runAction, setRegistryRuntime, setVariableMirror } from './registry';
import { captureEvent, captureTrigger, ScenarioRunner, type RunResult, type ScenarioFailure, type TriggerPacket } from './scenario-runner';
import type { EventAncestry } from './registry';
import { VariableStore, type VariableSnapshot, type VariableValue } from './variables';
import type { Trigger } from './scenario';
import type { PageChangePayload, RuntimeSync, RuntimeRequest } from './runtime-sync';
import { pageAfterRemoval, pageById } from './pages';
import { allPlacements, hasPlacement } from './skin-layouts';
import { mediaSourceKey, readMediaOptions, stepSlide } from './content';

export type PageChangeReason = 'action' | 'swipe' | 'dot' | 'auto' | 'reconcile';
let dashboardInteractionActive = false;

export type RuntimeSnapshot = {
  online: boolean;
  owner: boolean;
  revision: number;
  activePage: string;
  variables: VariableSnapshot;
  busy: Readonly<Record<string, number>>;
  content: Readonly<Record<string, { slide: number; reload: number }>>;
};
export type VariablePersistence = { save(envelope: ReturnType<VariableStore['serializePersistent']>): Promise<void> };
export type RuntimeOptions = { variables?: VariableStore; persistence?: VariablePersistence; owner?: boolean;
  onFailure?: (failure: ScenarioFailure) => void; onQueueFull?: (controlId: string, trigger: Trigger | 'event') => void };

type Job = { packet: TriggerPacket; fingerprint: string; notify: boolean; resolve(result: RunResult): void; controller?: AbortController;
  done?: { promise: Promise<RunResult>; resolve(result: RunResult): void } };
type Lane = { key: string; controlId: string; queue: Job[]; current?: Job; draining: boolean };
const EMPTY: RuntimeSnapshot = { online: false, owner: false, revision: 0, activePage: 'page-1',
  variables: { revision: 0, records: {} }, busy: {}, content: {} };
const VARIABLE_KEY = 'supadashboard:variables:v1';
const cancelled = (): RunResult => ({ status: 'cancelled' });
const scenarioId = () => globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function fingerprint(control: import('./controls').ControlConfig) {
  return JSON.stringify({ scenario: control.scenario, stateBinding: control.stateBinding, stateRoles: control.stateRoles,
    states: control.variants.map(variant => variant.id) });
}

export async function loadVariableState(): Promise<{ variables: VariableStore; persistence: VariablePersistence }> {
  if (isTauri()) {
    const store = await load('variables.json', { defaults: {}, autoSave: false });
    const variables = new VariableStore(await store.get('variables'));
    return { variables, persistence: { save: async envelope => { await store.set('variables', envelope); await store.save(); } } };
  }
  let envelope: unknown;
  try { envelope = JSON.parse(localStorage.getItem(VARIABLE_KEY) ?? 'null'); } catch { envelope = null; }
  let variables: VariableStore;
  try { variables = new VariableStore(envelope); } catch { variables = new VariableStore(); }
  return { variables, persistence: { save: async value => localStorage.setItem(VARIABLE_KEY, JSON.stringify(value)) } };
}

export class AutomationRuntime {
  readonly variables: VariableStore;
  readonly events = new EventRegistry();
  readonly snapshots = writable<RuntimeSnapshot>(EMPTY);
  readonly state: Readable<RuntimeSnapshot> = { subscribe: this.snapshots.subscribe };
  private readonly runner: ScenarioRunner;
  private readonly lanes = new Map<string, Lane>();
  private readonly busyCounts = new Map<string, number>();
  private readonly queueFullReported = new Set<string>();
  private readonly contentState = new Map<string, { slide: number; reload: number }>();
  private readonly contentSources = new Map<string, string>();
  private readonly contentPositions = new Map<string, { source: string; time: number }>();
  private readonly unsubscribeVariables: () => void;
  private readonly detachRegistry: () => void;
  private readonly stopRemoteSettings: () => void;
  private readonly stopSettingsEffect: () => void;
  private readonly owner: boolean;
  private readonly persistence?: VariablePersistence;
  private readonly onFailure: (failure: ScenarioFailure) => void;
  private readonly onQueueFull: (controlId: string, trigger: Trigger | 'event') => void;
  private revision = 0;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private clockTimer: ReturnType<typeof setInterval> | undefined;
  private rotationTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private lastValues: Record<string, VariableValue> = {};
  private variableAncestry = new Map<string, EventAncestry>();
  private activePage: string;
  private priorPageOrder: string[];
  private interactionActive = false;
  private readonly visibilityChanged = () => this.scheduleRotation();

  constructor(options: RuntimeOptions = {}) {
    this.variables = options.variables ?? new VariableStore();
    this.persistence = options.persistence;
    this.owner = options.owner ?? true;
    this.priorPageOrder = settings.deck.pages.map(page => page.id);
    this.activePage = pageById(settings.deck.pages, settings.deck.activePage)?.id ?? this.priorPageOrder[0] ?? 'page-1';
    if (this.owner) settings.deck.activePage = this.activePage;
    this.interactionActive = this.owner && dashboardInteractionActive;
    this.onFailure = options.onFailure ?? (() => {});
    this.onQueueFull = options.onQueueFull ?? (() => {});
    this.events.register({ id: 'variables.changed', title: 'Variable changed', plugin: 'core' });
    this.events.register({ id: 'page.changed', title: 'Page changed', plugin: 'core' });
    this.runner = new ScenarioRunner({
      runAction: (ref, context) => runAction(ref, context),
      getVariable: id => this.variables.getValue(id),
      findVariable: name => this.variables.findByName(name)?.value,
      setVariable: async (id, value, ancestry) => this.setVariable(id, value, ancestry),
      getState: id => this.getState(id),
      setState: (id, stateId) => this.setState(id, stateId),
      emitEvent: (id, parameter, payload, ancestry) => this.emitEvent(id, parameter, payload, ancestry),
      onError: () => {},
    });
    this.lastValues = Object.fromEntries(Object.entries(this.variables.snapshot().records).map(([id, record]) => [id, record.value]));
    this.unsubscribeVariables = this.variables.subscribe(snapshot => {
      this.publish(snapshot);
      if (this.owner) this.schedulePersist();
      for (const [id, record] of Object.entries(snapshot.records)) {
        if (Object.hasOwn(this.lastValues, id) && this.lastValues[id] !== record.value) {
          void this.emitEvent('variables.changed', id, { id, oldValue: this.lastValues[id], value: record.value,
          type: record.definition.type }, this.variableAncestry.get(id)).catch(() => {});
        }
      }
      this.lastValues = Object.fromEntries(Object.entries(snapshot.records).map(([id, record]) => [id, record.value]));
    });
    this.detachRegistry = setRegistryRuntime({ variables: this.variables,
      registerEvent: definition => { this.events.register(definition); },
      emitEvent: (id, parameter, payload, ancestry) => this.emitEvent(id, parameter, payload, ancestry),
    });
    this.stopRemoteSettings = onRemoteSettings(next => {
      this.reconcile(next.controls);
      if (this.owner) this.reconcilePages(next.deck.pages);
      if (this.owner) this.scheduleRotation();
    });
    this.stopSettingsEffect = $effect.root(() => {
      $effect(() => {
        const next = settings.controls;
        const signature = JSON.stringify(next.map(control => [control.id, fingerprint(control)]));
        void signature;
        this.reconcile(next);
      });
      $effect(() => {
        const pages = settings.deck.pages;
        if (this.owner) this.reconcilePages(pages);
      });
      $effect(() => {
        const interval = settings.pageRotation.intervalSeconds;
        const order = settings.deck.pages.map(page => page.id).join('\u0000');
        const active = settings.deck.activePage;
        void interval; void order; void active;
        if (this.owner) this.scheduleRotation();
      });
    });
    this.publish(this.variables.snapshot());
    if (this.owner) {
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibilityChanged);
      this.startClock();
      this.scheduleRotation();
    }
  }

  get isOwner() { return this.owner && !this.disposed; }

  dispatch(packet: TriggerPacket, options: { notify?: boolean } = {}): Promise<RunResult> {
    if (this.disposed || !this.owner) return Promise.resolve({ status: 'rejected' });
    const control = controlById(packet.controlId);
    if (!control) return Promise.resolve({ status: 'rejected' });
    const laneKey = `${packet.controlId}\u0000${packet.trigger === 'event' ? packet.listenerId ?? 'event' : packet.trigger}`;
    let lane = this.lanes.get(laneKey);
    if (!lane) { lane = { key: laneKey, controlId: packet.controlId, queue: [], draining: false }; this.lanes.set(laneKey, lane); }
    if (lane.queue.length >= 32) {
      if (options.notify !== false && !this.queueFullReported.has(laneKey)) {
        this.queueFullReported.add(laneKey);
        try { this.onQueueFull(packet.controlId, packet.trigger); } catch { /* status sink must not reject dispatch */ }
      }
      return Promise.resolve({ status: 'rejected' });
    }
    return new Promise(resolve => {
      lane!.queue.push({ packet: structuredClone(packet), fingerprint: fingerprint(control), notify: options.notify !== false, resolve });
      void this.drain(lane!);
    });
  }

  dispatchTrigger(controlId: string, itemId: string, trigger: Trigger, interactionId = scenarioId(), options: { notify?: boolean } = {}) {
    const control = controlById(controlId);
    if (!control) return Promise.resolve({ status: 'rejected' as const });
    const current = this.getState(controlId) ?? stateIdAt(control, settings.variants[controlId] ?? 0);
    const packet = captureTrigger(control, itemId, trigger, interactionId, current);
    return packet ? this.dispatch(packet, options) : Promise.resolve({ status: 'completed' as const });
  }

  getState(controlId: string) {
    const control = controlById(controlId);
    if (!control) return undefined;
    return effectiveVariant(control, this.variables, settings.variants[controlId] ?? 0).stateId;
  }

  setState(controlId: string, stateId: string) {
    if (this.disposed) throw new Error('Runtime is unavailable');
    const control = controlById(controlId);
    if (!control || !control.variants.length) throw new Error('Button state is unavailable');
    const count = control.variants.length, current = settings.variants[controlId] ?? 0;
    // Migrated gestures step relative to the current state.
    const index = stateId === 'next' ? (current + 1) % count : stateId === 'prev' ? (current - 1 + count) % count
      : control.variants.findIndex((_, i) => stateIdAt(control, i) === stateId);
    const resolved = index < 0 && /^\d+$/.test(stateId) && Number(stateId) < count ? Number(stateId) : index;
    if (resolved < 0) throw new Error('Button state is unavailable');
    settings.variants[controlId] = resolved;
  }

  contentCommand(controlId: string, command: 'next' | 'prev' | 'goto' | 'reload', index?: number) {
    if (this.disposed || !this.owner) throw new Error('Content runtime is unavailable');
    const control = controlById(controlId);
    if (!control || !hasPlacement(settings, controlId))
      throw new Error('Content target is unavailable');
    const current = this.contentState.get(controlId) ?? { slide: 0, reload: 0 };
    let next: { slide: number; reload: number };
    if (control.type === 'media' && (command === 'next' || command === 'prev' || command === 'goto')) {
      const options = readMediaOptions(control.options);
      if (command === 'goto') {
        if (!Number.isSafeInteger(index) || index! < 0 || index! >= options.sources.length)
          throw new Error('Media slide is unavailable');
        next = { ...current, slide: index! };
      } else {
        next = { ...current, slide: stepSlide(current.slide, options.sources.length, command === 'next' ? 1 : -1, options.loop) };
      }
    } else if (control.type === 'web' && command === 'reload') {
      next = { ...current, reload: current.reload + 1 };
    } else {
      throw new Error('Content command is not supported by this target');
    }
    if (next.slide === current.slide && next.reload === current.reload) return false;
    this.contentPositions.delete(controlId);
    this.contentState.set(controlId, next);
    this.publish(this.variables.snapshot());
    return true;
  }

  rememberVideoPosition(controlId: string, source: string, time: number) {
    if (this.disposed || !this.owner || !Number.isFinite(time) || time < 0) return;
    const control = controlById(controlId);
    if (!control || control.type !== 'media' ||
      !readMediaOptions(control.options).sources.some(entry => mediaSourceKey(entry) === source)) return;
    this.contentPositions.set(controlId, { source, time });
  }

  videoPosition(controlId: string, source: string) {
    if (this.disposed || !this.owner) return undefined;
    const saved = this.contentPositions.get(controlId);
    return saved?.source === source ? saved.time : undefined;
  }

  changePage(pageId: string, reason: PageChangeReason = 'action', ancestry?: EventAncestry) {
    if (this.disposed || !this.owner || !settings.deck.pages.some(page => page.id === pageId) || pageId === this.activePage) return false;
    const previousPage = this.activePage;
    this.activePage = pageId;
    settings.deck.activePage = pageId;
    this.publish(this.variables.snapshot());
    this.scheduleRotation();
    void this.emitEvent('page.changed', pageId, { previousPage, page: pageId, reason }, ancestry ? structuredClone(ancestry) : undefined).catch(() => {
      try { this.onFailure({ controlId: '', itemId: '', trigger: 'event', stepId: 'page.changed', kind: 'condition' }); }
      catch { /* a failure sink must not interrupt page navigation */ }
    });
    return true;
  }

  changePageInDirection(direction: 'next' | 'prev', reason: PageChangeReason = 'action', ancestry?: EventAncestry) {
    if (this.disposed || !this.owner) return false;
    const pages = settings.deck.pages;
    const index = pages.findIndex(page => page.id === this.activePage);
    if (index < 0 || pages.length < 2) return false;
    const next = (index + (direction === 'next' ? 1 : pages.length - 1)) % pages.length;
    return this.changePage(pages[next].id, reason, ancestry);
  }

  setInteractionActive(active: boolean) {
    if (this.disposed || !this.owner || this.interactionActive === active) return;
    this.interactionActive = active;
    this.scheduleRotation();
  }

  setVariable(id: string, value: VariableValue, ancestry?: EventAncestry) {
    if (this.disposed || !this.owner) throw new Error('Variable runtime is unavailable');
    if (ancestry) this.variableAncestry.set(id, ancestry);
    try { return Promise.resolve(this.variables.set(id, value, 'user')); }
    finally { this.variableAncestry.delete(id); }
  }

  async emitEvent(id: string, parameter?: string, payload?: unknown, ancestry?: EventAncestry) {
    if (this.disposed || !this.owner) throw new Error('Event runtime is unavailable');
    await this.events.emit(id, parameter, payload, settings.controls, async (target, eventParameter, eventPayload, path) => {
      const state = this.getState(target.control.id) ?? stateIdAt(target.control, settings.variants[target.control.id] ?? 0);
      const packet = captureEvent(target.control, '', target.listener, scenarioId(), state, Date.now(), eventParameter, eventPayload, path);
      return this.dispatch(packet);
    }, ancestry, () => this.onFailure({ controlId: '', itemId: '', trigger: 'event', stepId: 'cycle', kind: 'condition' }));
  }

  async simulate(controlId: string, trigger: Trigger = 'press', itemId = '', options: { notify?: boolean } = {}) {
    return this.dispatchTrigger(controlId, itemId, trigger, scenarioId(), options);
  }

  async stopControl(controlId: string) {
    const stopped: Promise<RunResult>[] = [];
    for (const lane of this.lanes.values()) if (lane.controlId === controlId) {
      for (const pending of lane.queue.splice(0)) pending.resolve(cancelled());
      if (lane.current) {
        lane.current.controller?.abort();
        if (lane.current.done) stopped.push(lane.current.done.promise);
      }
    }
    await Promise.all(stopped);
  }

  reconcile(controls: Settings['controls']) {
    const current = new Map(controls.map(control => [control.id, fingerprint(control)]));
    for (const lane of this.lanes.values()) {
      const expected = current.get(lane.controlId);
      if (expected === undefined || lane.current?.fingerprint !== expected) lane.current?.controller?.abort();
      if (expected === undefined) {
        for (const pending of lane.queue.splice(0)) pending.resolve(cancelled());
      } else {
        const keep = lane.queue.filter(job => job.fingerprint === expected);
        for (const job of lane.queue) if (!keep.includes(job)) job.resolve(cancelled());
        lane.queue = keep;
      }
    }
    const placed = new Set(allPlacements(settings).map(placement => placement.item.control));
    for (const id of this.contentState.keys()) if (!current.has(id) || !placed.has(id)) this.contentState.delete(id);
    for (const id of this.contentSources.keys()) if (!current.has(id) || !placed.has(id)) this.contentSources.delete(id);
    for (const id of this.contentPositions.keys()) if (!current.has(id) || !placed.has(id)) this.contentPositions.delete(id);
    for (const control of controls) if (control.type === 'media' && placed.has(control.id)) {
      const sourceKey = JSON.stringify(readMediaOptions(control.options).sources);
      const previous = this.contentSources.get(control.id);
      if (previous !== undefined && previous !== sourceKey) {
        this.contentPositions.delete(control.id);
        const state = this.contentState.get(control.id);
        if (state) this.contentState.set(control.id, { ...state, slide: 0 });
      }
      this.contentSources.set(control.id, sourceKey);
    }
    this.publish(this.variables.snapshot());
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    this.rotationTimer = undefined;
    if (this.owner && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.stopRemoteSettings();
    this.stopSettingsEffect();
    this.unsubscribeVariables();
    this.detachRegistry();
    for (const lane of this.lanes.values()) {
      lane.current?.controller?.abort();
      for (const pending of lane.queue.splice(0)) pending.resolve(cancelled());
    }
    await this.flushPersistence();
    this.contentState.clear();
    this.contentSources.clear();
    this.contentPositions.clear();
    this.publish(this.variables.snapshot(), true);
  }

  private async drain(lane: Lane) {
    if (lane.draining) return;
    lane.draining = true;
    try {
      while (lane.queue.length && !this.disposed) {
        const job = lane.queue.shift()!;
        const current = controlById(job.packet.controlId);
        if (!current || fingerprint(current) !== job.fingerprint) { job.resolve(cancelled()); continue; }
        const controller = new AbortController();
        job.controller = controller;
        lane.current = job;
        let complete!: (result: RunResult) => void;
        const done = new Promise<RunResult>(resolve => { complete = resolve; });
        job.done = { promise: done, resolve: complete };
        this.adjustBusy(job.packet.controlId, 1);
        let result: RunResult;
        try { result = await this.runner.run(job.packet, controller.signal); }
        catch { result = { status: 'failed' }; }
        if (job.notify && result.status === 'failed' && result.failure) {
          try { this.onFailure(result.failure); } catch { /* a toast sink cannot block a lane */ }
        }
        lane.current = undefined;
        this.adjustBusy(job.packet.controlId, -1);
        job.resolve(result);
        job.done?.resolve(result);
        if (!lane.queue.length) this.queueFullReported.delete(lane.key);
      }
    } finally {
      lane.draining = false;
      if (!lane.current && !lane.queue.length) this.lanes.delete(lane.key);
    }
  }

  private adjustBusy(controlId: string, delta: number) {
    const count = Math.max(0, (this.busyCounts.get(controlId) ?? 0) + delta);
    if (count) this.busyCounts.set(controlId, count); else this.busyCounts.delete(controlId);
    this.publish(this.variables.snapshot());
  }

  private publish(variables: VariableSnapshot, online = true) {
    this.revision++;
    this.snapshots.set({ online, owner: this.owner, revision: this.revision, activePage: this.activePage, variables,
      busy: Object.fromEntries(this.busyCounts), content: Object.fromEntries(this.contentState) });
  }

  reconcilePages(pages = settings.deck.pages) {
    const order = pages.map(page => page.id);
    const active = pageById(pages, this.activePage);
    if (!active) return;
    if (active.id !== this.activePage) {
      const next = pageAfterRemoval(pages, this.activePage, this.priorPageOrder) ?? active.id;
      this.changePage(next, 'reconcile');
    }
    this.priorPageOrder = order;
  }

  private scheduleRotation() {
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    this.rotationTimer = undefined;
    const interval = settings.pageRotation.intervalSeconds;
    if (!this.owner || this.disposed || interval < 5 || settings.deck.pages.length < 2 || this.interactionActive ||
      typeof document !== 'undefined' && document.hidden) return;
    this.rotationTimer = setTimeout(() => {
      this.rotationTimer = undefined;
      if (this.interactionActive || typeof document !== 'undefined' && document.hidden) return;
      this.changePageInDirection('next', 'auto');
    }, interval * 1000);
  }

  private schedulePersist() {
    if (!this.persistence || this.disposed) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => { this.persistTimer = undefined; void this.flushPersistence(); }, 200);
  }

  private async flushPersistence() {
    if (!this.persistence) return;
    try { await this.persistence.save(this.variables.serializePersistent()); }
    catch { /* persistence errors are surfaced by the owner boot adapter */ }
  }

  private startClock() {
    const update = () => {
      const now = new Date();
      const values: Record<string, string> = {
        'clock.time': new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now),
        'clock.date': new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now),
        'clock.day': new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(now),
      };
      for (const [id, value] of Object.entries(values)) if (this.variables.getValue(id) !== undefined && this.variables.getValue(id) !== value)
        this.variables.set(id, value, 'core');
    };
    update();
    this.clockTimer = setInterval(update, 1000);
  }
}

export const runtimeView = writable<RuntimeSnapshot>(EMPTY);
let clientSync: RuntimeSync | undefined;
let remoteRevision = 0;

export function setRuntimeSync(sync: RuntimeSync) {
  clientSync = sync;
  return () => { if (clientSync === sync) clientSync = undefined; };
}

export function acceptRuntimeSnapshot(snapshot: unknown, revision: number) {
  if (!snapshot || typeof snapshot !== 'object' || !Number.isSafeInteger(revision) || revision <= remoteRevision) return;
  const value = snapshot as RuntimeSnapshot;
  if (typeof value.activePage !== 'string' || !value.variables || typeof value.variables !== 'object' ||
    !value.busy || typeof value.busy !== 'object') return;
  remoteRevision = revision;
  setVariableMirror(Object.values(value.variables.records));
  settings.deck.activePage = value.activePage;
  runtimeView.set({ ...value, content: value.content && typeof value.content === 'object' ? value.content : {}, online: true, owner: false, revision });
}

export async function attachRuntimeConnection(sync: RuntimeSync) {
  const detach = setRuntimeSync(sync);
  remoteRevision = 0;
  runtimeView.set({ ...EMPTY, online: false, owner: false });
  try { acceptRuntimeSnapshot(await sync.request({ type: 'snapshot' }), sync.currentRevision); }
  catch { runtimeView.set({ ...EMPTY, online: false, owner: false }); }
  return () => {
    detach();
    sync.close();
    runtimeView.set({ ...EMPTY, online: false, owner: false });
  };
}

export function receiveRuntimeSnapshot(snapshot: unknown, revision: number) { acceptRuntimeSnapshot(snapshot, revision); }

export async function requestRuntime(request: RuntimeRequest) {
  if (!clientSync) throw new Error('Runtime owner is unavailable');
  return clientSync.request(request);
}

export async function requestPageChange(change: { direction: 'next' | 'prev' } | { page: string }, reason: 'dot' | 'swipe') {
  const runtime = currentRuntime();
  if (runtime?.isOwner) return 'page' in change ? runtime.changePage(change.page, reason) : runtime.changePageInDirection(change.direction, reason);
  const payload: PageChangePayload = 'page' in change ? { page: change.page, reason } : { direction: change.direction, reason };
  const snapshot = await requestRuntime({ type: 'changePage', payload }) as RuntimeSnapshot;
  return !!snapshot && typeof snapshot.activePage === 'string' && (!('page' in change) || snapshot.activePage === change.page);
}

export function setRuntimeInteraction(active: boolean) {
  dashboardInteractionActive = active;
  currentRuntime()?.setInteractionActive(active);
}

export async function dispatchRuntimeTrigger(controlId: string, itemId: string, trigger: Trigger) {
  const runtime = currentRuntime();
  if (runtime) return runtime.dispatchTrigger(controlId, itemId, trigger);
  try { return await requestRuntime({ type: 'simulate', payload: { controlId, itemId, trigger } }) as RunResult; }
  catch { return { status: 'rejected' } as RunResult; }
}

/** Capture the active state's immutable trigger list at interaction start. */
export function captureRuntimeTrigger(controlId: string, itemId: string, trigger: Trigger, interactionId: string = scenarioId()) {
  const control = controlById(controlId);
  if (!control) return undefined;
  const runtime = currentRuntime();
  const variables = runtime?.variables ?? get(runtimeView).variables;
  const stateId = runtime?.getState(controlId) ?? effectiveVariant(control, variables, settings.variants[controlId] ?? 0).stateId;
  return captureTrigger(control, itemId, trigger, interactionId, stateId);
}

/** Run a packet already captured on pointerdown; only the local runtime owner can execute it. */
export function dispatchRuntimePacket(packet: TriggerPacket | undefined) {
  const runtime = currentRuntime();
  return packet && runtime ? runtime.dispatch(packet) : Promise.resolve({ status: packet ? 'rejected' : 'completed' } as RunResult);
}

export async function simulateRuntimeEvent(eventId: string, parameter?: string) {
  const runtime = currentRuntime();
  if (runtime) { await runtime.emitEvent(eventId, parameter); return true; }
  try { await requestRuntime({ type: 'emitEvent', payload: { eventId, parameter } }); return true; }
  catch { return false; }
}

export async function stopRuntimeControl(controlId: string) {
  const runtime = currentRuntime();
  if (runtime) return runtime.stopControl(controlId);
  return requestRuntime({ type: 'stop', payload: { controlId } });
}

export type RuntimeSingleton = { runtime: AutomationRuntime; dispose(): Promise<void> };
let singleton: RuntimeSingleton | undefined;
let singletonPromise: Promise<RuntimeSingleton> | undefined;
export function bootRuntime(options: RuntimeOptions = {}) {
  if (singleton) return Promise.resolve(singleton);
  if (singletonPromise) return singletonPromise;
  singletonPromise = (async () => {
    const loaded = options.variables ? { variables: options.variables, persistence: options.persistence } : await loadVariableState();
    const runtime = new AutomationRuntime({ ...options, ...loaded });
    const unsubscribeView = runtime.snapshots.subscribe(snapshot => runtimeView.set(snapshot));
    let done = false;
    const dispose = async () => {
      if (done) return;
      done = true;
      await runtime.dispose();
      unsubscribeView();
      if (singleton?.runtime === runtime) singleton = undefined;
      singletonPromise = undefined;
    };
    singleton = { runtime, dispose };
    return singleton;
  })();
  return singletonPromise;
}
export function currentRuntime() { return singleton?.runtime; }
export async function stopRuntime() { await singleton?.dispose(); }

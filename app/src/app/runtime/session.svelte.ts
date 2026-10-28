import { writable, type Readable } from 'svelte/store';
import { settings, onRemoteSettings } from '../../features/settings/state.svelte';
import type { Settings } from '../../features/settings/schema';
import { controlById } from '../../features/settings/state.svelte';
import { effectiveVariant, stateIdAt } from '../../features/controls/button-state';
import { EventRegistry } from '../../features/automation/events';
import {
  runAction,
  setRegistryRuntime,
  skins as registeredSkins,
} from '../../features/plugins/registry';
import {
  captureEvent,
  captureTrigger,
  ScenarioRunner,
  type RunResult,
  type ScenarioFailure,
  type TriggerPacket,
} from '../../features/automation/scenario-runner';
import type { EventAncestry } from '../../features/plugins/contracts';
import {
  VariableStore,
  type VariableSnapshot,
  type VariableValue,
} from '../../features/automation/variables';
import type { Trigger } from '../../features/automation/scenario';
import { PageController, type PageChangeReason } from '../../features/layout/page-controller';
import { allPlacements, hasPlacement } from '../../features/layout/skin-layouts';
import { ContentController } from '../../features/media/content-controller';
import { SkinController } from '../../features/skins/skin-controller';
import { startClock } from '../../features/automation/clock';
import { EMPTY, type RuntimeSnapshot } from './state';
import type { VariablePersistence } from './variable-persistence';
import { ExecutionEngine } from '../../features/automation/execution-engine';

export type RuntimeOptions = {
  variables?: VariableStore;
  persistence?: VariablePersistence;
  owner?: boolean;
  onFailure?: (failure: ScenarioFailure) => void;
  onQueueFull?: (controlId: string, trigger: Trigger | 'event') => void;
};

const scenarioId = () =>
  globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function fingerprint(control: import('../../features/controls/model').ControlConfig) {
  return JSON.stringify({
    scenario: control.scenario,
    stateBinding: control.stateBinding,
    stateRoles: control.stateRoles,
    states: control.variants.map((variant) => variant.id),
  });
}

export class RuntimeSession {
  readonly variables: VariableStore;
  readonly events = new EventRegistry();
  readonly snapshots = writable<RuntimeSnapshot>(EMPTY);
  readonly state: Readable<RuntimeSnapshot> = { subscribe: this.snapshots.subscribe };
  private readonly execution: ExecutionEngine;
  private readonly content: ContentController;
  private readonly pages: PageController;
  private readonly skins: SkinController;
  private readonly unsubscribeVariables: () => void = () => {};
  private readonly detachRegistry: () => void = () => {};
  private readonly stopRemoteSettings: () => void = () => {};
  private readonly stopSettingsEffect: () => void = () => {};
  private readonly owner: boolean;
  private readonly persistence?: VariablePersistence;
  private readonly onFailure: (failure: ScenarioFailure) => void;
  private revision = 0;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly stopClock: () => void = () => {};
  private disposed = false;
  private lastValues: Record<string, VariableValue> = {};
  private variableAncestry = new Map<string, EventAncestry>();

  constructor(options: RuntimeOptions = {}) {
    this.variables = options.variables ?? new VariableStore();
    this.persistence = options.persistence;
    this.owner = options.owner ?? true;
    this.onFailure = options.onFailure ?? (() => {});
    this.content = new ContentController(() => this.publish(this.variables.snapshot()));
    this.pages = new PageController({
      getDeck: () => settings.deck,
      isOwner: () => this.isOwner,
      onChange: () => this.publish(this.variables.snapshot()),
      emitEvent: (id, parameter, payload, ancestry) =>
        this.emitEvent(id, parameter, payload, ancestry),
      onEventFailure: () =>
        this.onFailure({
          controlId: '',
          itemId: '',
          trigger: 'event',
          stepId: 'page.changed',
          kind: 'condition',
        }),
    });
    this.skins = new SkinController({
      definitions: registeredSkins,
      variables: this.variables,
      getSettings: () => settings.skinSettings,
      isOwner: () => this.isOwner,
      setVariable: (id, value, owner, ancestry) => this.writeVariable(id, value, owner, ancestry),
      emitEvent: (id, parameter, payload, ancestry) =>
        this.emitEvent(id, parameter, payload, ancestry),
    });
    this.events.register({ id: 'variables.changed', title: 'Variable changed', plugin: 'core' });
    this.events.register({ id: 'page.changed', title: 'Page changed', plugin: 'core' });
    const runner = new ScenarioRunner({
      runAction: (ref, context) => runAction(ref, context),
      getVariable: (id) => this.variables.getValue(id),
      findVariable: (name) => this.variables.findByName(name)?.value,
      setVariable: async (id, value, ancestry) => this.setVariable(id, value, ancestry),
      getState: (id) => this.getState(id),
      setState: (id, stateId) => this.setState(id, stateId),
      emitEvent: (id, parameter, payload, ancestry) =>
        this.emitEvent(id, parameter, payload, ancestry),
      onError: () => {},
    });
    this.execution = new ExecutionEngine({
      execute: (packet, signal) => runner.run(packet, signal),
      getFingerprint: (id) => {
        const control = controlById(id);
        return control ? fingerprint(control) : undefined;
      },
      onBusyChange: () => this.publish(this.variables.snapshot()),
      onFailure: this.onFailure,
      onQueueFull: options.onQueueFull,
    });
    this.lastValues = Object.fromEntries(
      Object.entries(this.variables.snapshot().records).map(([id, record]) => [id, record.value]),
    );
    try {
      this.unsubscribeVariables = this.variables.subscribe((snapshot, persistentChanged) => {
        this.publish(snapshot);
        if (this.owner && persistentChanged) {
          this.schedulePersist();
        }
        for (const [id, record] of Object.entries(snapshot.records)) {
          if (Object.hasOwn(this.lastValues, id) && this.lastValues[id] !== record.value) {
            void this.emitEvent(
              'variables.changed',
              id,
              {
                id,
                oldValue: this.lastValues[id],
                value: record.value,
                type: record.definition.type,
              },
              this.variableAncestry.get(id),
            ).catch(() => {});
          }
        }
        this.lastValues = Object.fromEntries(
          Object.entries(snapshot.records).map(([id, record]) => [id, record.value]),
        );
      });
      this.detachRegistry = setRegistryRuntime({
        variables: this.variables,
        registerEvent: (definition) => {
          this.events.register(definition);
        },
        emitEvent: (id, parameter, payload, ancestry) =>
          this.emitEvent(id, parameter, payload, ancestry),
      });
      this.skins.start();
      this.stopRemoteSettings = onRemoteSettings((next) => {
        this.reconcile(next.controls);
        if (this.owner) this.reconcilePages(next.deck.pages);
        if (this.owner) this.skins.reconcile(next.skinSettings);
      });
      this.stopSettingsEffect = $effect.root(() => {
        $effect(() => {
          const next = settings.controls;
          const signature = JSON.stringify(
            next.map((control) => [control.id, fingerprint(control)]),
          );
          void signature;
          this.reconcile(next);
        });
        $effect(() => {
          const pages = settings.deck.pages;
          if (this.owner) this.reconcilePages(pages);
        });
      });
      this.publish(this.variables.snapshot());
      this.stopClock = this.owner ? startClock(this.variables) : () => {};
    } catch (error) {
      try {
        this.stopResources();
      } catch {
        /* preserve the startup error after attempting every cleanup */
      }
      this.content.dispose();
      throw error;
    }
  }

  get isOwner() {
    return this.owner && !this.disposed;
  }

  dispatch(packet: TriggerPacket, options: { notify?: boolean } = {}): Promise<RunResult> {
    if (!this.isOwner) {
      return Promise.resolve({ status: 'rejected' });
    }
    return this.execution.dispatch(packet, options);
  }

  dispatchTrigger(
    controlId: string,
    itemId: string,
    trigger: Trigger,
    interactionId = scenarioId(),
    options: { notify?: boolean } = {},
  ) {
    const control = controlById(controlId);
    if (!control) return Promise.resolve({ status: 'rejected' as const });
    const current =
      this.getState(controlId) ?? stateIdAt(control, settings.variants[controlId] ?? 0);
    const packet = captureTrigger(control, itemId, trigger, interactionId, current);
    return packet
      ? this.dispatch(packet, options)
      : Promise.resolve({ status: 'completed' as const });
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
    const count = control.variants.length,
      current = settings.variants[controlId] ?? 0;
    // Migrated gestures step relative to the current state.
    const index =
      stateId === 'next'
        ? (current + 1) % count
        : stateId === 'prev'
          ? (current - 1 + count) % count
          : control.variants.findIndex((_, i) => stateIdAt(control, i) === stateId);
    const resolved =
      index < 0 && /^\d+$/.test(stateId) && Number(stateId) < count ? Number(stateId) : index;
    if (resolved < 0) throw new Error('Button state is unavailable');
    settings.variants[controlId] = resolved;
  }

  contentCommand(controlId: string, command: 'next' | 'prev' | 'goto' | 'reload', index?: number) {
    if (!this.isOwner) {
      throw new Error('Content runtime is unavailable');
    }
    const control = controlById(controlId);
    if (!control || !hasPlacement(settings, controlId)) {
      throw new Error('Content target is unavailable');
    }
    return this.content.command(control, command, index);
  }

  rememberVideoPosition(controlId: string, source: string, time: number) {
    if (!this.isOwner) {
      return;
    }
    const control = controlById(controlId);
    if (control) {
      this.content.rememberVideoPosition(control, source, time);
    }
  }

  videoPosition(controlId: string, source: string) {
    return this.isOwner ? this.content.videoPosition(controlId, source) : undefined;
  }

  changePage(pageId: string, reason: PageChangeReason = 'action', ancestry?: EventAncestry) {
    return this.pages.change(pageId, reason, ancestry);
  }

  changePageInDirection(
    direction: 'next' | 'prev',
    reason: PageChangeReason = 'action',
    ancestry?: EventAncestry,
  ) {
    return this.pages.changeInDirection(direction, reason, ancestry);
  }

  updateSkinConfig(skinId: string, stored?: Record<string, unknown>) {
    return this.skins.updateConfig(skinId, stored);
  }

  setVariable(id: string, value: VariableValue, ancestry?: EventAncestry) {
    return this.writeVariable(id, value, 'user', ancestry);
  }

  setSkinView(skinId: string, viewId: string, ancestry?: EventAncestry) {
    return this.skins.setView(skinId, viewId, ancestry);
  }

  setSkinState(skinId: string, key: string, value: VariableValue, ancestry?: EventAncestry) {
    return this.skins.setState(skinId, key, value, ancestry);
  }

  async emitSkinEvent(
    skinId: string,
    eventId: string,
    parameter?: string,
    payload?: unknown,
    ancestry?: EventAncestry,
  ) {
    return this.skins.emitEvent(skinId, eventId, parameter, payload, ancestry);
  }

  async emitEvent(id: string, parameter?: string, payload?: unknown, ancestry?: EventAncestry) {
    if (this.disposed || !this.owner) throw new Error('Event runtime is unavailable');
    await this.events.emit(
      id,
      parameter,
      payload,
      settings.controls,
      async (target, eventParameter, eventPayload, path) => {
        const state =
          this.getState(target.control.id) ??
          stateIdAt(target.control, settings.variants[target.control.id] ?? 0);
        const packet = captureEvent(
          target.control,
          '',
          target.listener,
          scenarioId(),
          state,
          Date.now(),
          eventParameter,
          eventPayload,
          path,
        );
        return this.dispatch(packet);
      },
      ancestry,
      () =>
        this.onFailure({
          controlId: '',
          itemId: '',
          trigger: 'event',
          stepId: 'cycle',
          kind: 'condition',
        }),
    );
  }

  async simulate(
    controlId: string,
    trigger: Trigger = 'press',
    itemId = '',
    options: { notify?: boolean } = {},
  ) {
    return this.dispatchTrigger(controlId, itemId, trigger, scenarioId(), options);
  }

  async stopControl(controlId: string) {
    return this.execution.stopControl(controlId);
  }

  reconcile(controls: Settings['controls']) {
    this.execution.reconcile(
      new Map(controls.map((control) => [control.id, fingerprint(control)])),
    );
    this.content.reconcile(
      controls,
      new Set(allPlacements(settings).map((placement) => placement.item.control)),
    );
    this.publish(this.variables.snapshot());
  }

  async dispose() {
    if (this.disposed) return;
    let failure: unknown;
    try {
      this.stopResources();
    } catch (error) {
      failure = error;
    }
    try {
      await this.flushPersistence();
    } finally {
      this.content.dispose();
      this.publish(this.variables.snapshot(), true);
    }
    if (failure) {
      throw failure;
    }
  }

  private stopResources() {
    this.disposed = true;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    const failures: unknown[] = [];
    for (const cleanup of [
      this.stopClock,
      this.stopRemoteSettings,
      this.stopSettingsEffect,
      this.unsubscribeVariables,
      () => this.skins.dispose(),
      this.detachRegistry,
      () => this.execution.dispose(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, 'Runtime cleanup failed');
    }
  }

  private writeVariable(id: string, value: VariableValue, owner: string, ancestry?: EventAncestry) {
    if (!this.isOwner) {
      throw new Error('Variable runtime is unavailable');
    }
    if (ancestry) {
      this.variableAncestry.set(id, ancestry);
    }
    try {
      return Promise.resolve(this.variables.set(id, value, owner));
    } finally {
      this.variableAncestry.delete(id);
    }
  }

  private publish(variables: VariableSnapshot, online = true) {
    this.revision++;
    this.snapshots.set({
      online,
      owner: this.owner,
      revision: this.revision,
      activePage: this.pages.activePage,
      variables,
      busy: this.execution.busy(),
      content: this.content.snapshot(),
    });
  }

  reconcilePages(pages = settings.deck.pages) {
    this.pages.reconcile(pages);
  }

  private schedulePersist() {
    if (!this.persistence || this.disposed) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.flushPersistence();
    }, 200);
  }

  private async flushPersistence() {
    if (!this.persistence) return;
    try {
      await this.persistence.save(this.variables.serializePersistent());
    } catch {
      /* persistence errors are surfaced by the owner boot adapter */
    }
  }
}

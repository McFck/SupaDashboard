import { writable } from 'svelte/store';
import { settings } from '../../features/settings/state.svelte';
import { onRemoteSettings } from '../../features/settings/persistence.svelte';
import type { Settings } from '../../features/settings/schema';
import { controlById } from '../../features/settings/state.svelte';
import { EventRegistry } from '../../features/automation/events';
import {
  runAction,
  setRegistryRuntime,
  skins as registeredSkins,
} from '../../features/plugins/registry';
import { captureEvent, captureTrigger } from '../../features/automation/capture';
import {
  ScenarioRunner,
  type RunResult,
  type ScenarioFailure,
  type TriggerPacket,
} from '../../features/automation/scenario-runner';
import type { ActionRef, EventAncestry } from '../../features/plugins/contracts';
import {
  VariableStore,
  type VariableSnapshot,
  type VariableValue,
} from '../../features/automation/variables';
import { newId, type Trigger } from '../../features/automation/scenario';
import { PageController, type PageChangeReason } from '../../features/layout/page-controller';
import { hasPlacement, storedPlacements } from '../../features/layout/placements';
import { ContentController } from '../../features/media/content-controller';
import { SkinController } from '../../features/skins/skin-controller';
import { startClock } from '../../features/automation/clock';
import { EMPTY, type RuntimeSnapshot } from './state';
import { VariableSaver, type VariablePersistence } from './variable-persistence';
import { controlStateId } from './control-state';
import { ExecutionEngine } from '../../features/automation/execution-engine';
import type { ControlConfig } from '../../features/controls/model';
import { stateIdAt } from '../../features/controls/variants';

export type RuntimeOptions = {
  variables?: VariableStore;
  persistence?: VariablePersistence;
  onFailure?: (failure: ScenarioFailure) => void;
  onQueueFull?: (controlId: string, trigger: Trigger | 'event') => void;
};

/** Resolves a state by ID, by index (older settings), or relative to `current` for migrated next/prev gestures. */
function stateIndex(control: ControlConfig, current: number, stateId: string) {
  const count = control.variants.length;
  if (stateId === 'next') {
    return (current + 1) % count;
  }
  if (stateId === 'prev') {
    return (current - 1 + count) % count;
  }
  const index = control.variants.findIndex((_, i) => stateIdAt(control, i) === stateId);
  if (index < 0 && /^\d+$/.test(stateId) && Number(stateId) < count) {
    return Number(stateId);
  }
  return index;
}

function fingerprint(control: ControlConfig) {
  return JSON.stringify({
    scenario: control.scenario,
    stateBinding: control.stateBinding,
    stateRoles: control.stateRoles,
    states: control.variants.map((variant) => variant.id),
  });
}

function valuesOf(snapshot: VariableSnapshot) {
  return Object.fromEntries(
    Object.entries(snapshot.records).map(([id, record]) => [id, record.value]),
  );
}

let current: RuntimeSession | undefined;

/** This window's live owner session; undefined in the panel and once the owner starts stopping. */
export function currentRuntime() {
  return current;
}

export class RuntimeSession {
  readonly variables: VariableStore;
  readonly events = new EventRegistry();
  readonly snapshots = writable<RuntimeSnapshot>(EMPTY);
  readonly execution: ExecutionEngine;
  private readonly runner: ScenarioRunner;
  private readonly quickActions = new Set<AbortController>();
  private readonly content: ContentController;
  readonly pages: PageController;
  readonly skins: SkinController;
  private unsubscribeVariables: () => void = () => {};
  private detachRegistry: () => void = () => {};
  private stopRemoteSettings: () => void = () => {};
  private stopSettingsEffect: () => void = () => {};
  private readonly saver: VariableSaver;
  private readonly onFailure: (failure: ScenarioFailure) => void;
  private revision = 0;
  private stopClock: () => void = () => {};
  private disposed = false;
  private lastValues: Record<string, VariableValue> = {};
  private variableAncestry = new Map<string, EventAncestry>();

  constructor(options: RuntimeOptions = {}) {
    this.variables = options.variables ?? new VariableStore();
    this.saver = new VariableSaver(this.variables, options.persistence);
    this.onFailure = options.onFailure ?? (() => {});
    this.content = new ContentController(() => this.publish());
    this.pages = new PageController({
      getDeck: () => settings.deck,
      isOwner: () => this.isOwner,
      onChange: () => this.publish(),
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
    this.runner = new ScenarioRunner({
      runAction: (ref, context) => runAction(ref, context),
      getVariable: (id) => this.variables.getValue(id),
      findVariable: (name) => this.variables.findByName(name)?.value,
      setVariable: async (id, value, ancestry) => this.setVariable(id, value, ancestry),
      getState: (id) => this.getState(id),
      setState: (id, stateId) => this.setState(id, stateId),
      emitEvent: (id, parameter, payload, ancestry) =>
        this.emitEvent(id, parameter, payload, ancestry),
    });
    this.execution = new ExecutionEngine({
      execute: (packet, signal) => this.runner.run(packet, signal),
      getFingerprint: (id) => {
        const control = controlById(id);
        return control ? fingerprint(control) : undefined;
      },
      onBusyChange: () => this.publish(),
      onFailure: this.onFailure,
      onQueueFull: options.onQueueFull,
    });
    this.lastValues = valuesOf(this.variables.snapshot());
    try {
      this.start();
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

  /** Attaches the session to settings, the plugin registry and its clock; undone by stopResources. */
  private start() {
    this.unsubscribeVariables = this.variables.subscribe((snapshot, persistentChanged) =>
      this.variablesChanged(snapshot, persistentChanged),
    );
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
      this.pages.reconcile(next.deck.pages);
      this.skins.reconcile(next.skinSettings);
    });
    this.stopSettingsEffect = $effect.root(() => {
      $effect(() => {
        const next = settings.controls;
        this.reconcile(next);
      });
      $effect(() => {
        const pages = settings.deck.pages;
        this.pages.reconcile(pages);
      });
    });
    this.publish();
    this.stopClock = startClock(this.variables);
    current = this;
  }

  /** Publishes, schedules a save and emits variables.changed for every value that changed. */
  private variablesChanged(snapshot: VariableSnapshot, persistentChanged: boolean) {
    this.publish();
    if (persistentChanged) {
      this.saver.schedule();
    }
    for (const [id, record] of Object.entries(snapshot.records)) {
      if (Object.hasOwn(this.lastValues, id) && this.lastValues[id] !== record.value) {
        const payload = {
          id,
          oldValue: this.lastValues[id],
          value: record.value,
          type: record.definition.type,
        };
        void this.emitEvent('variables.changed', id, payload, this.variableAncestry.get(id)).catch(
          () => {},
        );
      }
    }
    this.lastValues = valuesOf(snapshot);
  }

  get isOwner() {
    return !this.disposed;
  }

  dispatch(packet: TriggerPacket, options: { notify?: boolean } = {}): Promise<RunResult> {
    if (!this.isOwner) {
      return Promise.resolve({ status: 'rejected' });
    }
    return this.execution.dispatch(packet, options);
  }

  /** Skin quick actions belong to no control: they skip the control lanes and stop with the session. */
  async dispatchQuickAction(ref: ActionRef): Promise<RunResult> {
    if (!this.isOwner) {
      return { status: 'rejected' };
    }
    const controller = new AbortController();
    this.quickActions.add(controller);
    try {
      const result = await this.runner.run(
        {
          controlId: '',
          itemId: '',
          trigger: 'press',
          interactionId: newId(),
          sourceStateId: '',
          capturedAt: Date.now(),
          steps: [{ id: 'quick-action', kind: 'action', action: ref }],
        },
        controller.signal,
      );
      if (result.status === 'failed' && result.failure) {
        this.onFailure(result.failure);
      }
      return result;
    } finally {
      this.quickActions.delete(controller);
    }
  }

  dispatchTrigger(controlId: string, itemId: string, trigger: Trigger) {
    const control = controlById(controlId);
    if (!control) return Promise.resolve({ status: 'rejected' as const });
    const packet = captureTrigger(
      control,
      itemId,
      trigger,
      newId(),
      controlStateId(control, this.variables),
    );
    return packet ? this.dispatch(packet) : Promise.resolve({ status: 'completed' as const });
  }

  getState(controlId: string) {
    const control = controlById(controlId);
    return control && controlStateId(control, this.variables);
  }

  setState(controlId: string, stateId: string) {
    if (this.disposed) throw new Error('Runtime is unavailable');
    const control = controlById(controlId);
    if (!control || !control.variants.length) throw new Error('Button state is unavailable');
    const index = stateIndex(control, settings.variants[controlId] ?? 0, stateId);
    if (index < 0) throw new Error('Button state is unavailable');
    settings.variants[controlId] = index;
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

  changePage(pageId: string, reason: PageChangeReason, ancestry?: EventAncestry) {
    return this.pages.change(pageId, reason, ancestry);
  }

  changePageInDirection(
    direction: 'next' | 'prev',
    reason: PageChangeReason,
    ancestry?: EventAncestry,
  ) {
    return this.pages.changeInDirection(direction, reason, ancestry);
  }

  setVariable(id: string, value: VariableValue, ancestry?: EventAncestry) {
    return this.writeVariable(id, value, 'user', ancestry);
  }

  async emitEvent(id: string, parameter?: string, payload?: unknown, ancestry?: EventAncestry) {
    if (this.disposed) throw new Error('Event runtime is unavailable');
    await this.events.emit(
      id,
      parameter,
      payload,
      settings.controls,
      async (target, eventParameter, eventPayload, path) => {
        const packet = captureEvent(
          target.control,
          '',
          target.listener,
          newId(),
          controlStateId(target.control, this.variables),
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
          kind: 'cycle',
        }),
    );
  }

  reconcile(controls: Settings['controls']) {
    this.execution.reconcile(
      new Map(controls.map((control) => [control.id, fingerprint(control)] as const)),
    );
    this.content.reconcile(
      controls,
      new Set(storedPlacements(settings).map((placement) => placement.item.control)),
    );
    this.publish();
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
      await this.saver.flush();
    } finally {
      this.content.dispose();
    }
    if (failure) {
      throw failure;
    }
  }

  private stopResources() {
    this.disposed = true;
    if (current === this) {
      current = undefined;
    }
    this.saver.cancel();
    const failures: unknown[] = [];
    for (const cleanup of [
      this.stopClock,
      this.stopRemoteSettings,
      this.stopSettingsEffect,
      this.unsubscribeVariables,
      () => this.skins.dispose(),
      this.detachRegistry,
      () => this.execution.dispose(),
      () => this.quickActions.forEach((controller) => controller.abort()),
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

  private publish() {
    this.revision++;
    this.snapshots.set({
      online: true,
      owner: true,
      revision: this.revision,
      activePage: this.pages.activePage,
      variables: this.variables.snapshot(),
      busy: this.execution.busy(),
      content: this.content.snapshot(),
    });
  }
}

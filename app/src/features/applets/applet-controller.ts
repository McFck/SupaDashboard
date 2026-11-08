import { writable, type Writable } from 'svelte/store';
import type { VariableStore, VariableValue } from '../automation/variables';
import type { EventAncestry } from '../plugins/contracts';
import { appletActive } from './applet-activity';
import {
  nextAppletSettings,
  resolveAppletConfig,
  settingParams,
  validAppletStateValue,
} from './definition';
import { type AppletConfig, type AppletDef, type AppletRuntimeContext } from './contracts';

export class AppletController {
  private readonly configs = new Map<string, Writable<AppletConfig>>();
  private readonly signatures = new Map<string, string>();
  /** Applets whose `start` ran, in start order; a failed start stays here without a cleanup so it is not retried on every edit. */
  private readonly running = new Map<string, (() => void) | undefined>();

  constructor(
    private readonly host: {
      definitions: ReadonlyMap<string, AppletDef>;
      variables: VariableStore;
      getSettings(): Record<string, Record<string, unknown>>;
      isOwner(): boolean;
      setVariable(
        id: string,
        value: VariableValue,
        owner: string,
        ancestry?: EventAncestry,
      ): Promise<boolean>;
      emitEvent: AppletRuntimeContext['emitEvent'];
      /** Replaces the applet's stored values for the shown page and records an undo step labelled `label`. */
      writeSettings(
        appletId: string,
        update: (stored: Record<string, unknown>) => Record<string, unknown> | null,
        label: string,
      ): boolean;
      onStartFailed(appletId: string): void;
    },
  ) {}

  /** Seeds every applet's view, then runs `sync`. */
  start(appletIds: readonly (string | undefined)[]) {
    if (!this.host.isOwner()) {
      return;
    }
    for (const applet of this.host.definitions.values()) {
      const viewId = `${applet.id}.view`;
      if (!applet.views.some((view) => view.id === this.host.variables.getValue(viewId))) {
        void this.setVariable(applet, viewId, applet.defaultView);
      }
    }
    this.sync(appletIds);
  }

  /** Runs exactly the applets some page uses (`appletIds`) that are registered, and stops the rest. */
  sync(appletIds: readonly (string | undefined)[]) {
    if (!this.host.isOwner()) {
      return;
    }
    const wanted = new Set<string>();
    for (const id of appletIds) {
      if (id && this.host.definitions.has(id)) {
        wanted.add(id);
      }
    }
    for (const id of [...this.running.keys()].reverse()) {
      if (!wanted.has(id)) {
        this.stopApplet(id);
      }
    }
    for (const id of wanted) {
      const applet = this.host.definitions.get(id);
      if (applet?.start && !this.running.has(id)) {
        this.startApplet(applet, applet.start);
      }
    }
  }

  private startApplet(applet: AppletDef, start: NonNullable<AppletDef['start']>) {
    const stored = this.host.getSettings()[applet.id] ?? {};
    const config = writable<AppletConfig>(resolveAppletConfig(applet, stored));
    const context: AppletRuntimeContext = {
      config,
      active: appletActive(applet.id),
      getState: (key) => this.host.variables.getValue(`${applet.id}.${key}`),
      setState: (key, value, ancestry) => this.setState(applet.id, key, value, ancestry),
      setView: (viewId, ancestry) => this.setView(applet.id, viewId, ancestry),
      setConfig: (values) => this.setConfig(applet.id, values),
      emitEvent: (id, parameter, payload, ancestry) =>
        this.emitEvent(applet.id, id, parameter, payload, ancestry),
    };
    this.configs.set(applet.id, config);
    this.signatures.set(applet.id, JSON.stringify(stored));
    try {
      this.followConfigView(applet, resolveAppletConfig(applet, stored));
      const cleanup = start(context);
      this.running.set(applet.id, typeof cleanup === 'function' ? cleanup : undefined);
    } catch {
      this.running.set(applet.id, undefined);
      this.configs.delete(applet.id);
      this.signatures.delete(applet.id);
      this.host.onStartFailed(applet.id);
    }
  }

  private stopApplet(appletId: string) {
    const cleanup = this.running.get(appletId);
    this.running.delete(appletId);
    this.configs.delete(appletId);
    this.signatures.delete(appletId);
    try {
      cleanup?.();
    } catch {
      /* one plugin cleanup must not block the others */
    }
  }

  updateConfig(appletId: string, stored = this.host.getSettings()[appletId] ?? {}) {
    if (!this.host.isOwner()) {
      return false;
    }
    const applet = this.host.definitions.get(appletId);
    const store = this.configs.get(appletId);
    if (!applet || !store) {
      return false;
    }
    const signature = JSON.stringify(stored);
    if (this.signatures.get(appletId) === signature) {
      return false;
    }
    this.signatures.set(appletId, signature);
    const config = resolveAppletConfig(applet, stored);
    store.set(config);
    this.followConfigView(applet, config);
    return true;
  }

  /** An applet with a `view` setting shows the saved view, so it follows that setting per page. */
  private followConfigView(applet: AppletDef, config: AppletConfig) {
    const view = config.view;
    if (
      typeof view === 'string' &&
      applet.views.some((entry) => entry.id === view) &&
      this.host.variables.getValue(`${applet.id}.view`) !== view
    ) {
      void this.setVariable(applet, `${applet.id}.view`, view);
    }
  }

  reconcile(stored: Record<string, Record<string, unknown>>) {
    for (const id of this.configs.keys()) {
      this.updateConfig(id, stored[id] ?? {});
    }
  }

  setView(appletId: string, viewId: string, ancestry?: EventAncestry) {
    this.assertOwner();
    const applet = this.host.definitions.get(appletId);
    if (!applet || !applet.views.some((view) => view.id === viewId)) {
      throw new Error('Applet view is unavailable');
    }
    if (settingParams(applet.settings).some((param) => param.key === 'view')) {
      this.setConfig(appletId, { view: viewId });
    }
    return this.setVariable(applet, `${appletId}.view`, viewId, ancestry);
  }

  setConfig(appletId: string, values: Record<string, unknown>) {
    this.assertOwner();
    const applet = this.host.definitions.get(appletId);
    if (!applet) {
      throw new Error('Applet is unavailable');
    }
    const labels = settingParams(applet.settings)
      .filter((param) => Object.hasOwn(values, param.key))
      .map((param) => param.label.toLowerCase());
    return this.host.writeSettings(
      appletId,
      (stored) => {
        let next = stored;
        for (const [key, value] of Object.entries(values)) {
          next = nextAppletSettings(applet, next, key, value) ?? next;
        }
        return next === stored ? null : next;
      },
      `Change ${applet.title} ${labels.join(', ')}`,
    );
  }

  setState(appletId: string, key: string, value: VariableValue, ancestry?: EventAncestry) {
    this.assertOwner();
    const applet = this.host.definitions.get(appletId);
    const field = applet?.state?.find((entry) => entry.key === key);
    if (!applet || !field || !validAppletStateValue(field.type, value)) {
      throw new Error('Applet state is unavailable');
    }
    return this.setVariable(applet, `${appletId}.${key}`, value, ancestry);
  }

  async emitEvent(
    appletId: string,
    eventId: string,
    parameter?: string,
    payload?: unknown,
    ancestry?: EventAncestry,
  ) {
    this.assertOwner();
    const applet = this.host.definitions.get(appletId);
    if (!applet?.events?.some((event) => event.id === eventId)) {
      throw new Error('Applet event is unavailable');
    }
    return this.host.emitEvent(eventId, parameter, payload, ancestry);
  }

  dispose() {
    for (const id of [...this.running.keys()].reverse()) {
      this.stopApplet(id);
    }
  }

  private assertOwner() {
    if (!this.host.isOwner()) {
      throw new Error('Applet runtime is unavailable');
    }
  }

  private setVariable(
    applet: AppletDef,
    id: string,
    value: VariableValue,
    ancestry?: EventAncestry,
  ) {
    const owner = applet.plugin ?? applet.id;
    const record = this.host.variables.get(id);
    if (!record || record.definition.owner !== owner) {
      throw new Error('Applet variable is unavailable');
    }
    return this.host.setVariable(id, value, owner, ancestry);
  }
}

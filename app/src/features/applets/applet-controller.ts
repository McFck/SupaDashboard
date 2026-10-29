import { writable, type Writable } from 'svelte/store';
import type { VariableStore, VariableValue } from '../automation/variables';
import type { EventAncestry } from '../plugins/contracts';
import { resolveAppletConfig, validAppletStateValue } from './definition';
import { type AppletConfig, type AppletDef, type AppletRuntimeContext } from './contracts';

export class AppletController {
  private readonly configs = new Map<string, Writable<AppletConfig>>();
  private readonly signatures = new Map<string, string>();
  private readonly cleanups: (() => void)[] = [];

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
    },
  ) {}

  start() {
    if (!this.host.isOwner()) {
      return;
    }
    try {
      for (const applet of this.host.definitions.values()) {
        this.startApplet(applet);
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private startApplet(applet: AppletDef) {
    const viewId = `${applet.id}.view`;
    if (!applet.views.some((view) => view.id === this.host.variables.getValue(viewId))) {
      void this.setVariable(applet, viewId, applet.defaultView);
    }
    if (!applet.start) {
      return;
    }
    const stored = this.host.getSettings()[applet.id] ?? {};
    const config = writable<AppletConfig>(resolveAppletConfig(applet, stored));
    this.configs.set(applet.id, config);
    this.signatures.set(applet.id, JSON.stringify(stored));
    const context: AppletRuntimeContext = {
      config,
      getState: (key) => this.host.variables.getValue(`${applet.id}.${key}`),
      setState: (key, value, ancestry) => this.setState(applet.id, key, value, ancestry),
      setView: (viewId, ancestry) => this.setView(applet.id, viewId, ancestry),
      emitEvent: (id, parameter, payload, ancestry) =>
        this.emitEvent(applet.id, id, parameter, payload, ancestry),
    };
    const cleanup = applet.start(context);
    if (typeof cleanup === 'function') {
      this.cleanups.push(cleanup);
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
    store.set(resolveAppletConfig(applet, stored));
    return true;
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
      throw new Error('Skin view is unavailable');
    }
    return this.setVariable(applet, `${appletId}.view`, viewId, ancestry);
  }

  setState(appletId: string, key: string, value: VariableValue, ancestry?: EventAncestry) {
    this.assertOwner();
    const applet = this.host.definitions.get(appletId);
    const field = applet?.state?.find((entry) => entry.key === key);
    if (!applet || !field || !validAppletStateValue(field.type, value)) {
      throw new Error('Skin state is unavailable');
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
      throw new Error('Skin event is unavailable');
    }
    return this.host.emitEvent(eventId, parameter, payload, ancestry);
  }

  dispose() {
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch {
        /* one plugin cleanup must not block the others */
      }
    }
    this.configs.clear();
    this.signatures.clear();
  }

  private assertOwner() {
    if (!this.host.isOwner()) {
      throw new Error('Skin runtime is unavailable');
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
      throw new Error('Skin variable is unavailable');
    }
    return this.host.setVariable(id, value, owner, ancestry);
  }
}

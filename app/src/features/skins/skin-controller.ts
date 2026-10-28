import { writable, type Writable } from 'svelte/store';
import type { VariableStore, VariableValue } from '../automation/variables';
import type { EventAncestry } from '../plugins/contracts';
import { resolveSkinConfig, validSkinStateValue } from './definition';
import { type SkinConfig, type SkinDef, type SkinRuntimeContext } from './contracts';

export class SkinController {
  private readonly configs = new Map<string, Writable<SkinConfig>>();
  private readonly signatures = new Map<string, string>();
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly host: {
      definitions: ReadonlyMap<string, SkinDef>;
      variables: VariableStore;
      getSettings(): Record<string, Record<string, unknown>>;
      isOwner(): boolean;
      setVariable(
        id: string,
        value: VariableValue,
        owner: string,
        ancestry?: EventAncestry,
      ): Promise<boolean>;
      emitEvent: SkinRuntimeContext['emitEvent'];
    },
  ) {}

  start() {
    if (!this.host.isOwner()) {
      return;
    }
    for (const skin of this.host.definitions.values()) {
      const viewId = `${skin.id}.view`;
      if (!skin.views.some((view) => view.id === this.host.variables.getValue(viewId))) {
        void this.setVariable(skin, viewId, skin.defaultView);
      }
      if (!skin.runtime) {
        continue;
      }
      const stored = this.host.getSettings()[skin.id] ?? {};
      const config = writable<SkinConfig>(resolveSkinConfig(skin, stored));
      this.configs.set(skin.id, config);
      this.signatures.set(skin.id, JSON.stringify(stored));
      const context: SkinRuntimeContext = {
        config,
        getState: (key) => this.host.variables.getValue(`${skin.id}.${key}`),
        setState: (key, value, ancestry) => this.setState(skin.id, key, value, ancestry),
        setView: (viewId, ancestry) => this.setView(skin.id, viewId, ancestry),
        emitEvent: (id, parameter, payload, ancestry) =>
          this.emitEvent(skin.id, id, parameter, payload, ancestry),
      };
      const cleanup = skin.runtime(context);
      if (typeof cleanup === 'function') {
        this.cleanups.push(cleanup);
      }
    }
  }

  updateConfig(skinId: string, stored = this.host.getSettings()[skinId] ?? {}) {
    if (!this.host.isOwner()) {
      return false;
    }
    const skin = this.host.definitions.get(skinId);
    const store = this.configs.get(skinId);
    if (!skin || !store) {
      return false;
    }
    const signature = JSON.stringify(stored);
    if (this.signatures.get(skinId) === signature) {
      return false;
    }
    this.signatures.set(skinId, signature);
    store.set(resolveSkinConfig(skin, stored));
    return true;
  }

  reconcile(stored: Record<string, Record<string, unknown>>) {
    for (const id of this.configs.keys()) {
      this.updateConfig(id, stored[id] ?? {});
    }
  }

  setView(skinId: string, viewId: string, ancestry?: EventAncestry) {
    this.assertOwner();
    const skin = this.host.definitions.get(skinId);
    if (!skin || !skin.views.some((view) => view.id === viewId)) {
      throw new Error('Skin view is unavailable');
    }
    return this.setVariable(skin, `${skinId}.view`, viewId, ancestry);
  }

  setState(skinId: string, key: string, value: VariableValue, ancestry?: EventAncestry) {
    this.assertOwner();
    const skin = this.host.definitions.get(skinId);
    const field = skin?.state?.find((entry) => entry.key === key);
    if (!skin || !field || !validSkinStateValue(field.type, value)) {
      throw new Error('Skin state is unavailable');
    }
    return this.setVariable(skin, `${skinId}.${key}`, value, ancestry);
  }

  async emitEvent(
    skinId: string,
    eventId: string,
    parameter?: string,
    payload?: unknown,
    ancestry?: EventAncestry,
  ) {
    this.assertOwner();
    const skin = this.host.definitions.get(skinId);
    if (!skin?.events?.some((event) => event.id === eventId)) {
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

  private setVariable(skin: SkinDef, id: string, value: VariableValue, ancestry?: EventAncestry) {
    const owner = skin.plugin ?? skin.id;
    const record = this.host.variables.get(id);
    if (!record || record.definition.owner !== owner) {
      throw new Error('Skin variable is unavailable');
    }
    return this.host.setVariable(id, value, owner, ancestry);
  }
}

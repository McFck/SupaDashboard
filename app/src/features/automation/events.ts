import type { ControlConfig } from '../controls/model';
import type { EventAncestry, EventDef } from '../plugins/contracts';
import type { EventList } from './scenario';

export type EventTarget = { control: ControlConfig; listener: EventList };
export type EventDispatch = (target: EventTarget, parameter: string | undefined, payload: unknown,
  ancestry: EventAncestry) => Promise<unknown>;

function eventPayload(value: unknown) {
  let serialized: string;
  try { serialized = JSON.stringify(value ?? null); } catch { throw new Error('Event payload must be serializable'); }
  if (serialized.length > 64 * 1024) throw new Error('Event payload is too large');
  return JSON.parse(serialized) as unknown;
}

export function listenerKey(controlId: string, listenerId: string) { return `${controlId}\u0000${listenerId}`; }

/** Registry metadata stays separate from persisted listeners, so missing plugins remain repairable. */
export class EventRegistry {
  private definitions = new Map<string, EventDef>();
  private cyclicReported = false;

  register(definition: EventDef) {
    // parameterSuggestions may be a function, which structuredClone rejects.
    this.definitions.set(definition.id, { ...definition, ...(Array.isArray(definition.parameterSuggestions)
      ? { parameterSuggestions: structuredClone(definition.parameterSuggestions) } : {}) });
    return () => {
      if (this.definitions.get(definition.id)?.plugin === definition.plugin) this.definitions.delete(definition.id);
    };
  }

  unregisterPlugin(plugin: string) {
    for (const [id, definition] of this.definitions) if (definition.plugin === plugin) this.definitions.delete(id);
  }

  get(id: string) { const value = this.definitions.get(id); return value && structuredClone(value); }
  list() { return [...this.definitions.values()].map(value => structuredClone(value)); }

  async emit(id: string, parameter: string | undefined, payload: unknown, controls: readonly ControlConfig[],
    dispatch: EventDispatch, ancestry?: EventAncestry, onCycle: () => void = () => {}) {
    if (!this.definitions.has(id)) throw new Error(`Event "${id}" isn't available`);
    const safePayload = eventPayload(payload);
    const path = ancestry ?? { depth: 0, listeners: [] };
    if (path.depth >= 16) { this.reportCycle(onCycle); return; }
    const targets: EventTarget[] = [];
    for (const control of controls) for (const listener of control.scenario?.events ?? []) {
      if (listener.eventId !== id || listener.parameter !== undefined && listener.parameter !== parameter) continue;
      const key = listenerKey(control.id, listener.id);
      if (path.listeners.includes(key)) { this.reportCycle(onCycle); continue; }
      targets.push({ control, listener });
    }
    await Promise.all(targets.map(target => {
      const key = listenerKey(target.control.id, target.listener.id);
      const next = { depth: path.depth + 1, listeners: [...path.listeners, key] };
      return dispatch(target, parameter, structuredClone(safePayload), next);
    }));
  }

  private reportCycle(onCycle: () => void) {
    if (this.cyclicReported) return;
    this.cyclicReported = true;
    try { onCycle(); } catch { /* reporting can't restart event dispatch */ }
  }
}

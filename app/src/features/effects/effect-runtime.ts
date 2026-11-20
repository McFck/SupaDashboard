import type { TriggerPacket } from '../automation/scenario-runner';
import { isEffectId, type EffectId } from './catalogue';
import { isRecord } from '../automation/plain-data';
import { walkSteps } from '../automation/scenario';

/** Pull effects belong to the armed preview, even if execution is queued until after it fades. */
export function releasePullEffects(packet: TriggerPacket): TriggerPacket {
  const released = structuredClone(packet);
  delete released.effect;
  walkSteps({ triggers: { press: released }, events: [] }, (step) => {
    delete step.effect;
  });
  return released;
}

export type TileEffect = {
  id: number;
  tileId: string;
  controlId: string;
  effect: EffectId;
  loop: boolean;
  stopping: boolean;
  origin?: { x: number; y: number };
};
type Active = {
  value: TileEffect;
  interaction: string;
  timer?: ReturnType<typeof setTimeout>;
  detach(): void;
};

export function validTileEffects(value: unknown): value is TileEffect[] {
  if (!Array.isArray(value)) {
    return false;
  }
  const counts = new Map<string, number>();
  const ids = new Set<number>();
  return value.every((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'number' ||
      !Number.isSafeInteger(entry.id) ||
      entry.id < 1 ||
      ids.has(entry.id)
    ) {
      return false;
    }
    if (
      typeof entry.tileId !== 'string' ||
      typeof entry.controlId !== 'string' ||
      !isEffectId(entry.effect) ||
      typeof entry.loop !== 'boolean' ||
      typeof entry.stopping !== 'boolean'
    ) {
      return false;
    }
    if (
      entry.origin !== undefined &&
      (!isRecord(entry.origin) ||
        ![entry.origin.x, entry.origin.y].every(
          (axis) => typeof axis === 'number' && Number.isFinite(axis) && axis >= 0 && axis <= 1,
        ))
    ) {
      return false;
    }
    ids.add(entry.id);
    const count = (counts.get(entry.tileId) ?? 0) + 1;
    counts.set(entry.tileId, count);
    return count <= 2;
  });
}

/** The owner pairs each start with a stop, including effects whose actions have already finished. */
export class EffectRuntime {
  private serial = 0;
  private readonly active = new Map<number, Active>();
  private readonly holds = new Map<string, TriggerPacket>();

  constructor(private readonly changed: () => void) {}

  snapshot(): TileEffect[] {
    return [...this.active.values()].map((entry) => entry.value);
  }

  hold(packet: TriggerPacket) {
    const prior = this.holds.get(packet.interactionId);
    if (prior?.trigger === packet.trigger) {
      return;
    }
    this.end(packet.interactionId);
    this.holds.set(packet.interactionId, packet);
    if (packet.effect) {
      this.start(packet, packet.effect);
    } else if (packet.trigger.startsWith('swipe')) {
      const effects = new Set<EffectId>();
      walkSteps({ triggers: { press: packet }, events: [] }, (step) => {
        if (step.effect) {
          effects.add(step.effect);
        }
      });
      for (const effect of effects) {
        this.start(packet, effect);
      }
    }
  }

  start(packet: TriggerPacket, effect: EffectId, signal?: AbortSignal) {
    if (signal?.aborted) {
      return;
    }
    const loop = this.holds.get(packet.interactionId)?.trigger === packet.trigger;
    // Recognition already started the held effect before its action entered the runner.
    if (
      loop &&
      (packet.effect === effect || packet.trigger.startsWith('swipe')) &&
      [...this.active.values()].some(
        (entry) =>
          entry.interaction === packet.interactionId &&
          entry.value.effect === effect &&
          !entry.value.stopping,
      )
    ) {
      return;
    }
    const tileId = packet.itemId || packet.controlId;
    const sameTile = [...this.active.values()].filter((entry) => entry.value.tileId === tileId);
    if (sameTile.length >= 2) {
      this.remove(sameTile[0].value.id);
    }
    const id = ++this.serial;
    const abort = () => this.stop(id);
    const entry: Active = {
      value: {
        id,
        tileId,
        controlId: packet.controlId,
        effect,
        loop,
        stopping: false,
        origin: packet.origin,
      },
      interaction: packet.interactionId,
      detach: () => signal?.removeEventListener('abort', abort),
    };
    this.active.set(id, entry);
    signal?.addEventListener('abort', abort, { once: true });
    if (!loop) {
      entry.timer = setTimeout(() => this.stop(id), 760);
    }
    this.changed();
  }

  end(interaction: string) {
    this.holds.delete(interaction);
    for (const [id, entry] of this.active) {
      if (entry.interaction === interaction && entry.value.loop) {
        this.stop(id);
      }
    }
  }

  clear(controlId?: string) {
    let changed = false;
    for (const [interaction, packet] of this.holds) {
      if (!controlId || packet.controlId === controlId) {
        this.holds.delete(interaction);
      }
    }
    for (const [id, entry] of this.active) {
      if (!controlId || entry.value.controlId === controlId) {
        this.remove(id);
        changed = true;
      }
    }
    if (changed) {
      this.changed();
    }
  }

  private stop(id: number) {
    const entry = this.active.get(id);
    if (!entry || entry.value.stopping) {
      return;
    }
    clearTimeout(entry.timer);
    entry.detach();
    entry.value = { ...entry.value, stopping: true };
    entry.timer = setTimeout(() => {
      this.remove(id);
      this.changed();
    }, 180);
    this.changed();
  }

  private remove(id: number) {
    const entry = this.active.get(id);
    clearTimeout(entry?.timer);
    entry?.detach();
    this.active.delete(id);
  }
}

// The live side of one placed control: the state it shows, whether its scenario is running, and how its captured
// triggers reach the runtime. Button, Slider, ContentTile and Mixer share it.
import { fromStore } from 'svelte/store';
import { effectiveVariant } from '../control-state';
import type { PullSnapshot } from '../input/pull';
import type { ControlConfig } from '../model';
import { runtimeCommands } from '../../../app/runtime/commands';
import { runtimeView } from '../../../app/runtime/state';
import { runtimeVariables } from '../../automation/runtime-variables.svelte';
import type { Trigger } from '../../automation/scenario';
import { isTriggerPacket } from '../../automation/capture';
import type { TriggerPacket } from '../../automation/scenario-runner';
import { settings } from '../../settings/state.svelte';
import type { GestureEffectHandlers } from '../input/gestures';
import { releasePullEffects } from '../../effects/effect-runtime';
import { notifyTrigger } from '../../plugins/registry';

type Host = { control(): ControlConfig; itemId?(): string | undefined };
/** PullContent: settles a released pull and commits the action at the right moment. */
type PullRelease = { release(snapshot: PullSnapshot, commit: () => void): unknown };

export class ControlTile {
  readonly #host: Host;
  readonly #runtime = fromStore(runtimeView);
  private heldPacket: TriggerPacket | undefined;
  private origin = { x: 0.5, y: 0.5 };
  readonly gestureEffects: GestureEffectHandlers = {
    onEffectPoint: (point) => {
      this.origin = point;
    },
    onEffectHold: (captured) => {
      if (captured === this.heldPacket || !isTriggerPacket(captured)) {
        return;
      }
      this.heldPacket = captured;
      runtimeCommands.holdTileEffect(captured);
    },
    onEffectEnd: () => {
      if (this.heldPacket) {
        runtimeCommands.endTileEffect(this.heldPacket.interactionId);
      }
      this.heldPacket = undefined;
    },
  };

  readonly effective = $derived.by(() => {
    const control = this.#host.control();
    return effectiveVariant(control, runtimeVariables, settings.variants[control.id] ?? 0);
  });
  readonly current = $derived(this.effective.index);
  readonly variant = $derived.by(() => {
    const { variants } = this.#host.control();
    return variants[this.current] ?? variants[0];
  });
  readonly busy = $derived.by(() => (this.#runtime.current.busy[this.#host.control().id] ?? 0) > 0);

  constructor(host: Host) {
    this.#host = host;
  }

  /** Capture one trigger at press start, frozen with the state the control had then. */
  capture = (trigger: Trigger, interactionId: string) => {
    const packet = runtimeCommands.captureRuntimeTrigger(
      this.#host.control().id,
      this.#host.itemId?.() ?? '',
      trigger,
      interactionId,
    );
    return packet ? { ...packet, origin: this.origin } : undefined;
  };

  /** Run a captured trigger. A committed pull runs once its content has handed over to the new state. */
  run(captured: unknown, snapshot?: PullSnapshot, content?: PullRelease) {
    const original = isTriggerPacket(captured) ? captured : undefined;
    const packet =
      original && original === this.heldPacket && original.trigger.startsWith('swipe')
        ? releasePullEffects(original)
        : original;
    if (original && original.trigger !== 'event') {
      notifyTrigger(original.trigger);
    }
    if (snapshot) {
      void content?.release(snapshot, () => {
        void runtimeCommands.dispatchRuntimePacket(packet);
      });
      return;
    }
    void runtimeCommands.dispatchRuntimePacket(packet);
  }
}

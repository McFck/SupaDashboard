// The live side of one placed control: the state it shows, whether its scenario is running, and how its captured
// triggers reach the runtime. Button, Slider, ContentTile and Mixer share it.
import { fromStore } from 'svelte/store';
import { effectiveVariant } from '../control-state';
import type { PullSnapshot } from '../input/pull';
import type { ControlConfig } from '../model';
import { getRuntimeCommands } from '../../../app/runtime/context';
import { runtimeView } from '../../../app/runtime/state';
import { runtimeVariables } from '../../automation/runtime-variables.svelte';
import type { Trigger } from '../../automation/scenario';
import type { TriggerPacket } from '../../automation/scenario-runner';
import { settings } from '../../settings/state.svelte';

type Host = { control(): ControlConfig; itemId?(): string | undefined };
/** PullContent: settles a released pull and commits the action at the right moment. */
type PullRelease = { release(snapshot: PullSnapshot, commit: () => void): unknown };

export class ControlTile {
  readonly #host: Host;
  readonly #commands = getRuntimeCommands();
  readonly #runtime = fromStore(runtimeView);

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
  capture = (trigger: Trigger, interactionId: string) =>
    this.#commands.captureRuntimeTrigger(
      this.#host.control().id,
      this.#host.itemId?.() ?? '',
      trigger,
      interactionId,
    );

  /** Run a captured trigger. A committed pull runs once its content has handed over to the new state. */
  run(captured: unknown, snapshot?: PullSnapshot, content?: PullRelease) {
    const packet = captured as TriggerPacket | undefined;
    if (snapshot) {
      void content?.release(snapshot, () => {
        void this.#commands.dispatchRuntimePacket(packet);
      });
      return;
    }
    void this.#commands.dispatchRuntimePacket(packet);
  }
}

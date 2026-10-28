import { settings } from '../../features/settings/state.svelte';
import { effectiveVariant } from '../../features/controls/control-state';
import type { ControlConfig } from '../../features/controls/model';

/** The state a control shows now: its variable binding first, else its manual state. */
export function controlStateId(
  control: ControlConfig,
  variables: Parameters<typeof effectiveVariant>[1],
) {
  return effectiveVariant(control, variables, settings.variants[control.id] ?? 0).stateId;
}

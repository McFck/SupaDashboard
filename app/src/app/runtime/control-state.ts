import { settings } from '../../features/settings/state.svelte';
import { effectiveVariant, stateIdAt } from '../../features/controls/button-state';
import type { ControlConfig } from '../../features/controls/model';

/** The state a control shows now: its variable binding first, else its manual state. */
export function controlStateId(
  control: ControlConfig,
  variables: Parameters<typeof effectiveVariant>[1],
) {
  return effectiveVariant(control, variables, settings.variants[control.id] ?? 0).stateId;
}

/** Resolves a state by ID, by index (older settings), or relative to `current` for migrated next/prev gestures. */
export function stateIndex(control: ControlConfig, current: number, stateId: string) {
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

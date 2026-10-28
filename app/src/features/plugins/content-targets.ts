import { settings } from '../settings/state.svelte';
import { hasPlacement } from '../layout/placements';

/** Only placed widgets can receive content commands. */
export function contentTargets(type: 'media' | 'web') {
  return [
    { value: 'self', label: 'This widget' },
    ...settings.controls
      .filter((control) => control.type === type && hasPlacement(settings, control.id))
      .map((control) => ({ value: control.id, label: control.name })),
  ];
}

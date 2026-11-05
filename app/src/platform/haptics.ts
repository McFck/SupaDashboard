import { invoke, isTauri } from '@tauri-apps/api/core';

export const PULSE_KINDS = ['tick', 'tap', 'confirm'] as const;
export type PulseKind = (typeof PULSE_KINDS)[number];

export type HapticsConfig = { enabled: boolean; adbPath?: string; serial?: string };

/** Applies the settings natively; true when a tablet is connected. */
export async function configureHaptics(config: HapticsConfig) {
  return isTauri() && (await invoke<boolean>('haptics_configure', { config }));
}

export function pulse(kind: PulseKind) {
  if (isTauri()) {
    // Best effort: a missed buzz is not worth a toast.
    invoke('haptics_pulse', { kind }).catch(() => {});
  }
}

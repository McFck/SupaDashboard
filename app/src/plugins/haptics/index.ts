import { isTauri } from '@tauri-apps/api/core';
import { currentRuntime } from '../../app/runtime/session.svelte';
import type { Plugin } from '../../features/plugins/contracts';
import { configureHaptics, pulse, PULSE_KINDS, type PulseKind } from '../../platform/haptics';
import HapticsSection from './ui/HapticsSection.svelte';
import { DEFAULTS, loadSettings, toConfig, watchSettings, type HapticsSettings } from './settings';

const isKind = (value: unknown): value is PulseKind => PULSE_KINDS.includes(value as PulseKind);

export const hapticsPlugin: Plugin = {
  id: 'haptics',
  title: 'Haptics',
  description: 'Vibrates a USB-connected Android tablet over adb.',
  icon: 'vibrate',
  author: 'SupaDashboard',
  version: '1.0.0',
  updated: '2026-11-06',
  source: 'bundled',
  settingsSection: HapticsSection,
  setup(api) {
    api.registerIcon(
      'vibrate',
      'M12 5h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3M2 8l2 2-2 2 2 2-2 2M22 8l-2 2 2 2-2 2 2 2',
    );
    api.registerAction({
      id: 'haptics.pulse',
      title: 'Vibrate',
      params: [
        {
          key: 'kind',
          label: 'Kind',
          type: 'select',
          default: 'tap',
          suggestions: PULSE_KINDS.map((kind) => ({
            value: kind,
            label: kind[0].toUpperCase() + kind.slice(1),
          })),
        },
      ],
      run: ({ kind }) => {
        if (!isKind(kind)) {
          throw new Error('Unknown vibration');
        }
        pulse(kind);
      },
    });
    if (!isTauri()) {
      return;
    }
    let current: HapticsSettings = DEFAULTS;
    const stops: (() => void)[] = [];
    // The native side keeps the last configuration, so both windows applying the same one is harmless.
    loadSettings()
      .then((saved) => {
        current = saved;
        return saved.enabled ? configureHaptics(toConfig(saved)) : undefined;
      })
      .catch((error) => console.warn('haptics', error));
    watchSettings((saved) => (current = saved))
      .then((stop) => stops.push(stop))
      .catch((error) => console.warn('haptics', error));
    stops.push(
      api.onTrigger((trigger) => {
        if (
          trigger === 'press' &&
          current.enabled &&
          current.pressPulse &&
          currentRuntime()?.isOwner
        ) {
          pulse('tap');
        }
      }),
    );
    import.meta.hot?.dispose(() => stops.forEach((stop) => stop()));
  },
};

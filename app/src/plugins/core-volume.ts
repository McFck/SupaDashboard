import { get } from 'svelte/store';
import { walkSteps } from '../features/automation/scenario';
import { settings } from '../features/settings/state.svelte';
import { pageItems } from '../features/layout/placements';
import { appOwners } from '../features/plugins/registry';
import type { PluginApi, Param } from '../features/plugins/contracts';
import {
  findVolumeChannel,
  initVolumeSync,
  readVolume,
  setMuted,
  setVolume,
  volumeChannels,
  type Channel,
} from '../features/media/volume';

/** Apps with an audio session right now (process names without .exe). */
let liveChannels: Channel[] = [];
/** Every app with an audio session, excluding master volume. */
const stopVolumeTargets = volumeChannels.subscribe((list) => {
  liveChannels = list.filter((c) => c.target !== 'system');
});
if (import.meta.hot) {
  import.meta.hot.dispose(stopVolumeTargets);
}
export const mixer = async () => {
  await initVolumeSync();
  return get(volumeChannels);
};
/** Targets already used by widgets in any layout, so they stay pickable while that app is closed. */
function usedTargets() {
  const placed = new Set(
    pageItems(settings.deck.pages, settings.appletLayouts).map((i) => i.control),
  );
  const out: unknown[] = [];
  for (const c of settings.controls) {
    if (!placed.has(c.id)) {
      continue;
    }
    const refs: unknown[] = c.variants.map((variant) => variant.value);
    if (c.scenario) {
      walkSteps(c.scenario, (step) => {
        if (step.kind === 'action') {
          refs.push(step.action);
        }
      });
    }
    // Only volume refs name an audio app; other actions use `target` for controls (e.g. 'self').
    for (const ref of refs) {
      const r = ref as { id?: string; args?: Record<string, unknown> } | null;
      if (r && typeof r === 'object' && (r.id === 'volume' || r.id?.startsWith('volume.'))) {
        out.push(r.args?.target);
      }
    }
    const channels = c.options?.channels;
    if (Array.isArray(channels)) {
      for (const ch of channels) {
        out.push(ch?.target);
      }
    }
  }
  return out.filter((t): t is string => typeof t === 'string' && t !== '' && t !== 'system');
}
const title = (a: string) => a[0].toUpperCase() + a.slice(1);
const targetParam: Param = {
  key: 'target',
  label: 'Volume of',
  type: 'select',
  default: 'system',
  suggestions: () => [
    { value: 'system', label: 'System' },
    ...[...new Set([...liveChannels.map((channel) => channel.target), ...usedTargets()])]
      .sort()
      .map((target) => ({
        value: target,
        label: liveChannels.find((channel) => channel.target === target)?.label ?? title(target),
        plugin: appOwners.get(target.toLowerCase()),
      })),
  ],
  refresh: mixer,
};

export function registerCoreVolume(api: PluginApi) {
  api.registerAction({
    id: 'volume.step',
    title: 'Change volume by a step',
    params: [targetParam, { key: 'by', label: 'Step (-1 to 1)', type: 'number', default: 0.05 }],
    run: async (a) => {
      const t = (a.target as string) || 'system';
      const now = await readVolume(t);
      if (now != null) {
        await setVolume(t, now + Number(a.by ?? 0.05));
      }
    },
  });
  api.registerAction({
    id: 'volume.mute',
    title: 'Mute / unmute',
    params: [targetParam],
    run: async (a) => {
      const t = (a.target as string) || 'system';
      const channel = findVolumeChannel(await mixer(), t);
      if (channel) {
        await setMuted(t, !channel.muted);
      }
    },
  });
  // target: "system" or a process name such as "discord".
  api.registerValue({
    id: 'volume',
    title: 'Volume',
    params: [targetParam],
    get: (a) => readVolume((a.target as string) || 'system'),
    set: (a, v) => setVolume((a.target as string) || 'system', Number(v)),
  });
}

import { toast } from 'svelte-sonner';
import { currentRuntime } from '../../app/runtime/session.svelte';
import { runtimeView } from '../../app/runtime/state';
import type { Plugin, PluginApi } from '../../features/plugins/contracts';
import { subscribeVoice, voiceCommand, type VoiceView } from '../../platform/discord';
import ConnectionSection from './ui/ConnectionSection.svelte';

function followOwner(api: PluginApi) {
  let stopVoice: (() => void) | undefined;
  let stopped = false;
  const update = (view: VoiceView) => {
    if (!currentRuntime()?.isOwner) {
      return;
    }
    const connected = view.state === 'idle' || view.state === 'inVoice';
    void Promise.all([
      api.setVariable('discord.muted', connected && view.muted),
      api.setVariable('discord.deafened', connected && view.deafened),
    ]).catch(() => toast.error('Discord state unavailable'));
  };
  const stopRuntime = runtimeView.subscribe(() => {
    if (stopped) {
      return;
    }
    if (currentRuntime()?.isOwner) {
      // Assign before subscribing: a synchronous variable update publishes another runtime snapshot.
      if (!stopVoice) {
        stopVoice = () => {};
        stopVoice = subscribeVoice(update);
      }
    } else {
      stopVoice?.();
      stopVoice = undefined;
    }
  });
  const dispose = () => {
    stopped = true;
    stopRuntime();
    stopVoice?.();
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose, { once: true });
  import.meta.hot?.dispose(dispose);
}

export const discordPlugin: Plugin = {
  id: 'discord',
  title: 'Discord',
  description: 'Voice channel and voice controls for Discord.',
  icon: 'discord-voice',
  author: 'SupaDashboard',
  version: '1.0.0',
  updated: '2026-11-04',
  source: 'bundled',
  settingsSection: ConnectionSection,
  setup(api) {
    api.registerIcon(
      'discord-voice',
      'M8 4 5 5C3 8 2 12 2 16l4 2 1-2m10 0 1 2 4-2c0-4-1-8-3-11l-3-1-1 2H9L8 4M9 11v2m6-2v2M7 16c3 1 7 1 10 0',
    );
    api.registerAppIcon('discord', 'discord-voice');
    for (const [command, title] of [
      ['toggleMute', 'Toggle mute'],
      ['toggleDeaf', 'Toggle deafen'],
      ['leave', 'Leave channel'],
      ['rejoin', 'Rejoin last channel'],
    ] as const) {
      api.registerAction({
        id: `discord.${command}`,
        title,
        run: async (_args, context) => {
          if (context?.signal.aborted) {
            return;
          }
          if (!currentRuntime()?.isOwner) {
            throw new Error('Discord runtime is unavailable');
          }
          await voiceCommand(command);
        },
      });
    }
    for (const field of ['muted', 'deafened'] as const) {
      api.registerVariable({
        id: `discord.${field}`,
        name: `discord.${field}`,
        type: 'boolean',
        initialValue: false,
        persistent: false,
        readOnly: true,
      });
    }
    followOwner(api);
  },
};

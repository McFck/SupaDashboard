import { setStepFeedback } from './ui/offset-ruler';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { currentRuntime } from '../../app/runtime/session.svelte';
import { runtimeView } from '../../app/runtime/state';
import { emptyScenario } from '../../features/automation/scenario';
import type { Plugin, PluginApi } from '../../features/plugins/contracts';
import { nativeSessions } from '../../platform/media';
import { spotifyCommand, spotifyTransport, subscribeSpotify } from '../../platform/spotify';
import ConnectionSection from './ui/ConnectionSection.svelte';
import LyricsEditor from './ui/LyricsEditor.svelte';
import LyricsTile from './ui/LyricsTile.svelte';

function followOwner(api: PluginApi) {
  let stopSources: (() => void) | undefined;
  let stopped = false;
  let lastError: string | undefined;
  const set = (values: Record<string, boolean | string>) => {
    if (!currentRuntime()?.isOwner) {
      return;
    }
    void Promise.all(
      Object.entries(values).map(([field, value]) => api.setVariable(`spotify.${field}`, value)),
    ).catch(() => toast.error('Spotify state unavailable'));
  };
  const stopRuntime = runtimeView.subscribe(() => {
    if (stopped) {
      return;
    }
    if (currentRuntime()?.isOwner) {
      if (stopSources) {
        return;
      }
      // Set before subscribing: variable writes can synchronously publish another runtime snapshot.
      stopSources = () => {};
      let smartShuffle = false;
      let shuffle = false;
      let webShuffle: boolean | undefined;
      const shuffleValue = () => {
        if (smartShuffle) {
          return 'smart';
        }
        return (webShuffle ?? shuffle) ? 'shuffle' : 'off';
      };
      const stopSpotify = subscribeSpotify((view) => {
        if (!currentRuntime()?.isOwner) {
          return;
        }
        smartShuffle = view.state === 'ready' && view.smartShuffle;
        webShuffle = view.state === 'ready' ? view.shuffle : undefined;
        set({
          connected: view.state === 'ready',
          liked: view.state === 'ready' && view.liked === true,
          shuffle: shuffleValue(),
        });
        if (view.error && view.error !== lastError) {
          toast.error(view.error);
        }
        lastError = view.error;
      });
      const controller = new AbortController();
      const stopMedia = nativeSessions('spotify')((state) => {
        const sessions = state.state === 'ready' ? state.sessions : [];
        const session =
          sessions.find((s) => s.current) ??
          sessions.find((s) => s.state === 'playing') ??
          sessions[0];
        shuffle = session?.shuffle === true;
        set({ shuffle: shuffleValue(), repeat: session?.repeat ?? 'off' });
      }, controller.signal);
      stopSources = () => {
        stopSpotify();
        controller.abort();
        stopMedia();
      };
    } else {
      stopSources?.();
      stopSources = undefined;
    }
  });
  const dispose = () => {
    stopped = true;
    stopRuntime();
    stopSources?.();
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose, { once: true });
  import.meta.hot?.dispose(dispose);
}

export const spotifyPlugin: Plugin = {
  id: 'spotify',
  title: 'Spotify',
  description: 'Lyrics, playback and library controls for Spotify.',
  icon: 'spotify',
  author: 'SupaDashboard',
  version: '1.0.0',
  updated: '2026-11-05',
  default: true,
  source: 'bundled',
  settingsSection: ConnectionSection,
  setup(api) {
    api.registerIcon(
      'spotify',
      'M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20zM7 9.5c3.5-1 7.5-.6 10.5 1M7.5 12.6c3-.8 6.3-.4 8.8 1M8 15.6c2.5-.6 5-.3 7 .8',
    );
    api.registerAppIcon('spotify', 'spotify');
    setStepFeedback(() => api.runAction('haptics.pulse', { kind: 'tick' }));
    api.registerMediaSource({
      id: 'spotify',
      title: 'Spotify',
      // The native side matches Windows media sessions by app id; "spotify" picks the desktop app.
      command: (command, sessionId) =>
        invoke('media_command', { target: 'spotify', command, sessionId }),
    });
    api.registerStatusSource({
      id: 'spotify',
      title: 'Spotify',
      kind: 'nowPlaying',
      mediaSourceId: 'spotify',
      subscribe: nativeSessions('spotify'),
    });
    api.registerControl({
      type: 'spotifyLyrics',
      title: 'Lyrics',
      icon: 'spotify',
      component: LyricsTile,
      editor: LyricsEditor,
      size: { w: 2, h: 3 },
      minSize: { w: 2, h: 1 },
      maxSize: { w: 8, h: 8 },
      triggers: [],
      create: () => ({
        name: 'Lyrics',
        scenario: emptyScenario(),
        variants: [{ id: 'state-1', label: '' }],
      }),
    });
    for (const [op, title] of [
      ['like', 'Like song'],
      ['unlike', 'Unlike song'],
      ['dislike', 'Dislike song'],
    ] as const) {
      api.registerAction({
        id: `spotify.${op}`,
        title,
        bindableVariable: () => 'spotify.liked',
        run: async (_args, context) => {
          if (context?.signal.aborted) {
            return;
          }
          if (!currentRuntime()?.isOwner) {
            throw new Error('Spotify runtime is unavailable');
          }
          await spotifyCommand(op);
        },
      });
    }
    for (const [op, title, modes, initial] of [
      [
        'shuffle',
        'Shuffle',
        [
          ['on', 'On'],
          ['off', 'Off'],
          ['toggle', 'Toggle'],
        ],
        'toggle',
      ],
      [
        'repeat',
        'Repeat',
        [
          ['off', 'Off'],
          ['context', 'Playlist'],
          ['track', 'Song'],
          ['cycle', 'Cycle'],
        ],
        'cycle',
      ],
    ] as const) {
      api.registerAction({
        id: `spotify.${op}`,
        title,
        bindableVariable: () => `spotify.${op}`,
        params: [
          {
            key: 'mode',
            label: 'Mode',
            type: 'select',
            default: initial,
            suggestions: modes.map(([value, label]) => ({ value, label })),
          },
        ],
        run: async (args, context) => {
          if (context?.signal.aborted) {
            return;
          }
          if (!currentRuntime()?.isOwner) {
            throw new Error('Spotify runtime is unavailable');
          }
          await spotifyTransport(`${op}:${String(args.mode ?? initial)}`);
        },
      });
    }
    for (const field of ['liked', 'shuffle', 'connected', 'repeat'] as const) {
      api.registerVariable({
        id: `spotify.${field}`,
        name: `spotify.${field}`,
        type: field === 'repeat' || field === 'shuffle' ? 'string' : 'boolean',
        initialValue: field === 'repeat' || field === 'shuffle' ? 'off' : false,
        ...(field === 'shuffle' ? { options: ['off', 'shuffle', 'smart'] } : {}),
        ...(field === 'repeat' ? { options: ['off', 'context', 'track'] } : {}),
        persistent: false,
        readOnly: true,
      });
    }
    followOwner(api);
  },
};

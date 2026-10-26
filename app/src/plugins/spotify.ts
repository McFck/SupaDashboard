// Spotify integration as a plugin: the core only knows "media sources" and "app volumes".
// Today it drives the desktop app through Windows' media session; a Web API connection
// (now playing, like, shuffle…) can be added here later without touching the core.
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Plugin } from '../features/plugins/contracts';

export const spotifyPlugin: Plugin = {
  id: 'spotify',
  title: 'Spotify',
  description: 'Control the Spotify desktop app from any button and see it in the volume mixer.',
  icon: 'spotify',
  author: 'SupaDashboard',
  version: '1.0.0',
  updated: '2026-10-23',
  default: true,
  source: 'bundled',
  size: 1354,
  setup(api) {
    api.registerIcon(
      'spotify',
      'M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20zM7 9.5c3.5-1 7.5-.6 10.5 1M7.5 12.6c3-.8 6.3-.4 8.8 1M8 15.6c2.5-.6 5-.3 7 .8',
    );
    api.registerAppIcon('spotify', 'spotify');
    api.registerMediaSource({
      id: 'spotify',
      title: 'Spotify',
      // The native side matches Windows media sessions by app id; "spotify" picks the desktop app.
      command: (command) => invoke('media_command', { target: 'spotify', command }),
    });
    api.registerAction({
      id: 'spotify.open',
      title: 'Open Spotify',
      run: () => openUrl('spotify:'),
    });
  },
};

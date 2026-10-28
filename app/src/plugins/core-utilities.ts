import { openUrl } from '@tauri-apps/plugin-opener';
import type { PluginApi } from '../features/plugins/contracts';

export function registerCoreUtilities(api: PluginApi) {
  api.registerAction({
    id: 'open',
    title: 'Open URL or app link',
    params: [{ key: 'url', label: 'URL', type: 'text', default: 'https://' }],
    run: (a) => openUrl(String(a.url)),
  });
  for (const [app, icon] of [
    ['discord', 'MessageCircle'],
    ['chrome', 'Chrome'],
    ['msedge', 'Globe'],
    ['firefox', 'Globe'],
    ['steam', 'Gamepad2'],
    ['vlc', 'Clapperboard'],
    ['teams', 'Users'],
    ['zoom', 'Video'],
  ] as const) {
    api.registerAppIcon(app, icon);
  }
}

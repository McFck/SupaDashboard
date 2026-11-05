// Start-up for both windows: one bundle serves the transparent dashboard ("main") and the control panel.
import { mount, tick } from 'svelte';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { install, installEnabled } from '../features/plugins/registry';
import { redo, startHistory, undo } from '../features/layout/history.svelte';
import { loadSettings } from '../features/settings/persistence.svelte';
import { startAppIcons } from '../features/apps/icons.svelte';
import { initVolumeSync } from '../features/media/volume';
import { followRemovals } from '../features/layout/removal';
import { appsPlugin } from '../plugins/core-apps';
import { corePlugin } from '../plugins/core';
import { spotifyPlugin } from '../plugins/spotify/index';
import { discordPlugin } from '../plugins/discord';
import { hapticsPlugin } from '../plugins/haptics';
import { subwayPlugin } from '../plugins/subway';
import { uiPlugin } from '../plugins/ui';

import { startRuntimeServices, stopRuntimeServices, type WindowView } from './runtime/services';
import Root from './Root.svelte';
import ControlPanel from '../panel/ControlPanel.svelte';
import Dashboard from '../features/dashboard/Dashboard.svelte';

const BUNDLED_PLUGINS = [
  corePlugin,
  appsPlugin,
  uiPlugin,
  spotifyPlugin,
  discordPlugin,
  hapticsPlugin,
  subwayPlugin,
];

let disposed = false;
let stopAppIcons: (() => void) | undefined;

function currentView(): WindowView {
  let label: string;
  try {
    label = getCurrentWindow().label;
  } catch {
    // A plain browser has no Tauri window; `?view=panel` selects the panel.
    label = new URLSearchParams(location.search).get('view') ?? 'main';
  }
  return label === 'panel' ? 'panel' : 'dashboard';
}

function dispose() {
  disposed = true;
  stopAppIcons?.();
  void stopRuntimeServices();
}

/** The native panel handshake: the shell shows the panel window once it reports ready. */
async function panelGeneration() {
  try {
    const bootstrap = await invoke<{ generation: number }>('panel_bootstrap');
    if (Number.isSafeInteger(bootstrap?.generation) && bootstrap.generation >= 0) {
      return bootstrap.generation;
    }
    console.warn('panel bootstrap returned an invalid generation');
  } catch (error) {
    console.warn('panel bootstrap', error);
  }
  return undefined;
}

async function installPlugins() {
  try {
    await installEnabled(...BUNDLED_PLUGINS);
  } catch (error) {
    console.warn('plugins', error);
    install(...BUNDLED_PLUGINS);
  }
}

function isTextInput(target: EventTarget | null) {
  const element = target as HTMLElement;
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

function handleUndoShortcut(event: KeyboardEvent) {
  if (!event.ctrlKey || event.altKey || isTextInput(event.target)) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === 'z') {
    event.preventDefault();
    if (event.shiftKey) {
      redo();
    } else {
      undo();
    }
  } else if (key === 'y') {
    event.preventDefault();
    redo();
  }
}

export async function startApp() {
  const view = currentView();
  const native = isTauri();
  // Both views are bundled statically: lazy view chunks left the panel without its own stylesheet in release builds.
  const content = view === 'panel' ? ControlPanel : Dashboard;
  document.documentElement.classList.toggle('transparent', view === 'dashboard');
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('pagehide', dispose, { once: true });
  if (import.meta.hot) {
    import.meta.hot.dispose(dispose);
  }

  const generation = native && view === 'panel' ? await panelGeneration() : undefined;
  if (disposed) {
    return;
  }

  await installPlugins();
  try {
    await loadSettings();
  } catch (error) {
    console.warn('settings', error);
  }
  try {
    stopAppIcons = await startAppIcons();
    if (disposed) {
      stopAppIcons();
    }
  } catch (error) {
    console.warn('app icons', error);
  }
  const volume = initVolumeSync().catch((error) => console.warn('volume sync', error));
  if (view === 'dashboard') {
    await volume;
  }
  if (disposed) {
    return;
  }

  void startRuntimeServices(view).catch((error) => console.warn('automation runtime', error));
  if (view === 'panel') {
    startHistory();
    document.addEventListener('keydown', handleUndoShortcut);
  }
  followRemovals();
  mount(Root, {
    target: document.getElementById('app')!,
    props: { content },
  });

  await tick();
  if (!disposed && generation !== undefined) {
    try {
      await invoke('panel_ready', { generation });
    } catch (error) {
      console.warn('panel ready', error);
    }
  }
}

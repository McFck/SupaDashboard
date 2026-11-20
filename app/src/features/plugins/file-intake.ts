// `.sdplugin` files that reach the panel without the Market: dropped onto it, or opened from Explorer (the running
// instance holds the path until the panel asks).
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { toast } from 'svelte-sonner';
import { takeOpenedPluginFile } from '../../platform/plugin-host';
import { installPluginFromFile } from './file-install';
import { refreshPlugins } from './lifecycle';

export class PluginFileIntake {
  #stops: (() => void)[] = [];
  #destroyed = false;
  /** One confirmation at a time; a file arriving meanwhile is dropped. */
  #busy = false;

  constructor() {
    void this.#listen().catch((error) => console.error(error));
  }

  async #listen() {
    const stops = await Promise.all([
      getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type === 'drop') {
          void this.#install(payload.paths.find((path) => path.endsWith('.sdplugin')));
        }
      }),
      listen('plugin-file-opened', () => void this.#takeOpened()),
    ]);
    if (this.#destroyed) {
      stops.forEach((stop) => stop());
      return;
    }
    this.#stops = stops;
    await this.#takeOpened();
  }

  async #takeOpened() {
    try {
      await this.#install((await takeOpenedPluginFile()) ?? undefined);
    } catch (error) {
      console.error(error);
      toast.error('Could not open plugin file');
    }
  }

  async #install(path: string | undefined) {
    if (!path || this.#busy || this.#destroyed) {
      return;
    }
    this.#busy = true;
    try {
      const id = await installPluginFromFile(path);
      if (id !== null) {
        await refreshPlugins();
      }
    } catch (error) {
      console.error(error);
      toast.error('Could not install plugin');
    } finally {
      this.#busy = false;
    }
  }

  destroy() {
    this.#destroyed = true;
    this.#stops.forEach((stop) => stop());
    this.#stops = [];
  }
}

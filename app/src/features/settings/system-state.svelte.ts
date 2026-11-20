// Panel-scoped native settings state (monitors, autostart, app updates), preloaded once and refreshed in place
// so opening Settings never flashes placeholder values or animates switches from an unknown default.
import { getVersion } from '@tauri-apps/api/app';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { primaryMonitor, type Monitor } from '@tauri-apps/api/window';
import { toast } from 'svelte-sonner';
import { version as bundledVersion } from '../../../package.json';
import { monitors } from '../../platform/window';

export type UpdateStatus =
  { kind: 'idle' | 'checking' | 'installing' } | { kind: 'available'; version: string };

let monitorGeneration = 0;
let autostartGeneration = 0;
let versionLoaded = false;
let passiveUpdateCheckStarted = false;

class SettingsSystemState {
  screens = $state<Monitor[]>([]);
  nativeNames = $state<unknown[]>([]);
  primaryScreen = $state<Monitor | null>(null);
  monitorsLoaded = $state(false);
  /** Read from the Run key; stays undefined (switch disabled) where there is no native side. */
  autostart = $state<boolean | undefined>(undefined);
  currentVersion = $state(bundledVersion);
  updateStatus = $state<UpdateStatus>({ kind: 'idle' });

  async refreshMonitors() {
    if (!isTauri()) {
      this.monitorsLoaded = true;
      return;
    }
    const generation = ++monitorGeneration;
    const [monitorResult, nativeResult, primaryResult] = await Promise.allSettled([
      monitors(),
      invoke<unknown[]>('monitor_names'),
      primaryMonitor(),
    ]);
    if (generation !== monitorGeneration) {
      return;
    }
    if (monitorResult.status === 'fulfilled') {
      this.screens = monitorResult.value;
    }
    if (nativeResult.status === 'fulfilled' && Array.isArray(nativeResult.value)) {
      this.nativeNames = nativeResult.value;
    }
    if (primaryResult.status === 'fulfilled') {
      this.primaryScreen = primaryResult.value;
    }
    this.monitorsLoaded = true;
  }

  async refreshAutostart() {
    if (!isTauri()) {
      return;
    }
    const generation = ++autostartGeneration;
    try {
      const enabled = await invoke<boolean>('autostart_get');
      if (generation === autostartGeneration && typeof enabled === 'boolean') {
        this.autostart = enabled;
      }
    } catch (error) {
      console.warn('autostart', error);
    }
  }

  async setAutostart(enabled: boolean) {
    const previous = this.autostart;
    autostartGeneration++;
    this.autostart = enabled;
    try {
      await invoke('autostart_set', { enabled });
    } catch (error) {
      console.error(error);
      this.autostart = previous ?? !enabled;
      toast.error('Could not change start with Windows');
    }
  }

  preloadUpdates() {
    if (!isTauri()) {
      return;
    }
    if (!versionLoaded) {
      versionLoaded = true;
      void getVersion()
        .then((version) => {
          this.currentVersion = version;
        })
        .catch(() => {
          versionLoaded = false;
          toast.error('Could not read app version');
        });
    }
    if (!passiveUpdateCheckStarted) {
      passiveUpdateCheckStarted = true;
      void this.checkForUpdates(false);
    }
  }

  async checkForUpdates(refresh: boolean) {
    if (!isTauri()) {
      return;
    }
    if (this.updateStatus.kind === 'checking' || this.updateStatus.kind === 'installing') {
      return;
    }
    // Passive checks update silently in the background so revisiting Settings never flashes a disabled button.
    if (refresh) {
      this.updateStatus = { kind: 'checking' };
    }
    try {
      const version = await invoke<unknown>('update_check', { refresh });
      if (version === null) {
        this.updateStatus = { kind: 'idle' };
      } else if (typeof version === 'string' && version.length > 0) {
        this.updateStatus = { kind: 'available', version };
      } else {
        throw new Error('Invalid update version');
      }
    } catch {
      if (refresh) {
        this.updateStatus = { kind: 'idle' };
        toast.error('Could not check for updates');
      }
    }
  }

  async installAvailableUpdate() {
    if (!isTauri() || this.updateStatus.kind !== 'available') {
      return;
    }
    const available = this.updateStatus;
    this.updateStatus = { kind: 'installing' };
    try {
      await invoke('update_install', { version: available.version });
    } catch {
      this.updateStatus = available;
      toast.error('Could not install update');
    }
  }

  preload() {
    if (!isTauri()) {
      return;
    }
    void this.refreshAutostart();
    void this.refreshMonitors();
    this.preloadUpdates();
  }
}

export const settingsSystem = new SettingsSystemState();

// The native plugin host: each plugin's native part is its own process behind one generic command.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const callPlugin = <T>(plugin: string, method: string, params: unknown = null) =>
  invoke<T>('plugin_call', { plugin, method, params });

/** Starts or stops the plugin's process with the plugin; plugins without a native part ignore it. */
export const setPluginProcessEnabled = (plugin: string, enabled: boolean) =>
  invoke<void>('plugin_set_enabled', { plugin, enabled });

/** `restarted` means a crashed process came back without its state; the plugin applies it again. */
export const onPluginEvent = <T>(plugin: string, event: string, handler: (payload: T) => void) =>
  listen<T>(`plugin://${plugin}/${event}`, (message) => handler(message.payload));

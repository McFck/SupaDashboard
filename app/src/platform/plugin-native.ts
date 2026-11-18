// Native capabilities for plugins, each bound to the plugin id passed first and limited to what its manifest's
// `permissions` declare (`plugin_host/caps/` in Rust). Tokens never reach JS: a header carries `{{secret:<client>}}`.
import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  PluginBrowserAction,
  PluginBrowserScrollFrame,
  PluginBrowserSnapshot,
} from '../features/plugins/contracts';

/** A file directly in a listed folder; `modified` in Unix milliseconds. */
export interface PluginFile {
  name: string;
  size: number;
  modified: number;
}

/** Text files in the plugin's own data folder; paths are `/`-separated, `''` is the folder itself. */
export const pluginStorage = {
  /** The file's text, or `null` when it does not exist. */
  read: (plugin: string, path: string) =>
    invoke<string | null>('plugin_storage_read', { plugin, path }),
  write: (plugin: string, path: string, text: string) =>
    invoke<void>('plugin_storage_write', { plugin, path, text }),
  remove: (plugin: string, path: string) => invoke<void>('plugin_storage_remove', { plugin, path }),
  list: (plugin: string, dir = '') => invoke<PluginFile[]>('plugin_storage_list', { plugin, dir }),
};

export interface PluginHttpRequest {
  method: 'GET' | 'PUT' | 'DELETE' | 'POST';
  /** `https://<declared host>/...` */
  url: string;
  headers?: Record<string, string>;
}

export interface PluginHttpResponse {
  status: number;
  retryAfter: string | null;
  body: string;
}

/** A body-less HTTPS request to a declared host; 10 s, no redirects, at most 1 MiB back. */
export const pluginHttp = (plugin: string, request: PluginHttpRequest) =>
  invoke<PluginHttpResponse>('plugin_http_request', { plugin, request });

/** A client's record without its tokens; `expiresAt` in Unix milliseconds. */
export interface PluginSecret {
  fields: Record<string, unknown>;
  signedIn: boolean;
  expiresAt: number | null;
}

/** The record of a declared OAuth client; `write` sets fields (`null` removes one), never tokens. */
export const pluginSecrets = {
  read: (plugin: string, name: string) =>
    invoke<PluginSecret>('plugin_secrets_read', { plugin, name }),
  write: (plugin: string, name: string, fields: Record<string, unknown>) =>
    invoke<void>('plugin_secrets_write', { plugin, name, fields }),
};

/** PKCE sign-in of a declared OAuth client; the tokens land in its secret record. */
export const pluginOAuth = {
  /** Opens the consent page and waits up to 5 minutes for the loopback redirect. */
  signIn: (plugin: string, name: string, clientId: string) =>
    invoke<void>('plugin_oauth_sign_in', { plugin, name, clientId }),
  /** The S256 challenge for a code that arrives another way; `exchange` from the same window uses its verifier. */
  pkce: (plugin: string, name: string) => invoke<string>('plugin_oauth_pkce', { plugin, name }),
  exchange: (plugin: string, name: string, clientId: string, code: string) =>
    invoke<void>('plugin_oauth_exchange', { plugin, name, clientId, code }),
  /** Fails with "Sign in again" (and signs out) when the refresh token was rejected. */
  refresh: (plugin: string, name: string) => invoke<void>('plugin_oauth_refresh', { plugin, name }),
  /** Drops the tokens; the other fields stay. */
  signOut: (plugin: string, name: string) =>
    invoke<void>('plugin_oauth_sign_out', { plugin, name }),
};

/** Opens a link of a declared scheme with its registered app. */
export const pluginOpen = (plugin: string, url: string) =>
  invoke<void>('plugin_open', { plugin, url });

/** A message from a local app's pipe; after `closed` the handle is gone. */
export type PluginPipeEvent = { kind: 'frame'; op: number; data: unknown } | { kind: 'closed' };

/**
 * A declared local app's named pipe `<prefix>-<0..9>`, framed as op + JSON (op <= 4, <= 64 KiB). A string exactly
 * `{{secret:<name>}}` in sent data is replaced by that token when it may go to `pipe:<prefix>`.
 */
export const pluginPipe = {
  open: (plugin: string, name: string, onEvent: (event: PluginPipeEvent) => void) =>
    invoke<number>('plugin_pipe_open', { plugin, name, events: new Channel(onEvent) }),
  send: (plugin: string, handle: number, op: number, data: unknown) =>
    invoke<void>('plugin_pipe_send', { plugin, handle, op, data }),
  close: (plugin: string, handle: number) => invoke<void>('plugin_pipe_close', { plugin, handle }),
};

export interface PluginProcessOutput {
  code: number | null;
  stdout: string;
}

/** A line of a spawned program's output, or its end. */
export type PluginProcessEvent =
  { kind: 'stdout'; text: string } | { kind: 'exited'; code: number | null };

/**
 * Declared programs by file name, bare (PATH) or an absolute path after `%VAR%` expansion; no console window, and
 * killed with the page that started them.
 */
export const pluginProcess = {
  /** Runs to the end, at most `timeoutMs` (<= 10000) and 1 MiB of output. */
  run: (plugin: string, program: string, args: string[], timeoutMs: number) =>
    invoke<PluginProcessOutput>('plugin_process_run', { plugin, program, args, timeoutMs }),
  spawn: (
    plugin: string,
    program: string,
    args: string[],
    onEvent: (event: PluginProcessEvent) => void,
  ) =>
    invoke<number>('plugin_process_spawn', { plugin, program, args, events: new Channel(onEvent) }),
  write: (plugin: string, handle: number, text: string) =>
    invoke<void>('plugin_process_write', { plugin, handle, text }),
  /** No `exited` event follows. */
  kill: (plugin: string, handle: number) => invoke<void>('plugin_process_kill', { plugin, handle }),
  /** Runs the command when the PC sleeps or shuts down; `args: null` disarms. One per plugin. */
  onPowerOff: (plugin: string, program: string, args: string[] | null) =>
    invoke<void>('plugin_process_on_power_off', { plugin, program, args }),
};

/** A declared web sign-in in its own window and profile; its token serves http `{{secret:<name>}}`. */
export const pluginSignIn = {
  /** Resolves with the token's expiry in Unix milliseconds; hidden, it renews from the saved session or fails. */
  open: (plugin: string, name: string, options: { visible: boolean }) =>
    invoke<number>('plugin_signin_open', { plugin, name, visible: options.visible }),
  /** Forgets the token and deletes the window's profile. */
  signOut: (plugin: string, name: string) =>
    invoke<void>('plugin_signin_sign_out', { plugin, name }),
};

/** The buttons in a declared program's visible windows; `parents` are ancestor indexes, nearest first. */
export interface PluginAutomationSnapshot {
  id: number;
  running: boolean;
  buttons: { name: string; parents: number[] }[];
}

/** Reads and presses buttons of a declared program without focusing it. One watch per page. */
export const pluginAutomation = {
  watch: (plugin: string, exe: string, onSnapshot: (snapshot: PluginAutomationSnapshot) => void) =>
    invoke<void>('plugin_automation_watch', { plugin, exe, events: new Channel(onSnapshot) }),
  /** Fails when the snapshot is no longer current. */
  invoke: (plugin: string, snapshot: number, index: number) =>
    invoke<void>('plugin_automation_invoke', { plugin, snapshot, index }),
};

const scrollGestures = new Map<number, { reported: boolean }>();

/** Connects a page to the plugin's declared Chromium extension. */
export const pluginBrowser = {
  watch: (plugin: string, onSnapshot: (snapshot: PluginBrowserSnapshot) => void) =>
    invoke<number>('plugin_browser_watch', { plugin, events: new Channel(onSnapshot) }),
  unwatch: (plugin: string, watch: number) => {
    scrollGestures.delete(watch);
    return invoke<void>('plugin_browser_unwatch', { plugin, watch });
  },
  pair: (plugin: string, watch: number) =>
    invoke<{ code: string; expiresInMs: number }>('plugin_browser_pair', { plugin, watch }),
  action: (plugin: string, watch: number, action: PluginBrowserAction) =>
    invoke<void>('plugin_browser_action', { plugin, watch, action }),
  scroll: (plugin: string, watch: number, frame: PluginBrowserScrollFrame) => {
    if (frame.phase === 'hold') {
      scrollGestures.set(watch, { reported: false });
    }
    const gesture = scrollGestures.get(watch);
    void invoke<void>('plugin_browser_scroll', { plugin, watch, frame }).catch((error: unknown) => {
      if (gesture && !gesture.reported && scrollGestures.has(watch)) {
        gesture.reported = true;
        console.warn('WebCompanion scroll', error);
      }
    });
  },
};

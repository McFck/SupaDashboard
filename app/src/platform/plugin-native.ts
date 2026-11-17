// Native capabilities for plugins, each bound to the plugin id passed first and limited to what its manifest's
// `permissions` declare (`plugin_host/caps/` in Rust). Tokens never reach JS: a header carries `{{secret:<client>}}`.
import { invoke } from '@tauri-apps/api/core';

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

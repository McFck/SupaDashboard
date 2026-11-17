// The public plugin API, imported by external plugins as `@supadashboard/kit`. Deliberately a re-export module:
// every export is a promise to plugin authors, so it holds only what they use. A breaking change here or a Svelte
// upgrade bumps PLUGIN_API.
export const PLUGIN_API = 2;

export { Button } from '$lib/components/ui/button';
export { Input } from '$lib/components/ui/input';
export { Label } from '$lib/components/ui/label';
export { Switch } from '$lib/components/ui/switch';
export { KineticScroll } from '$lib/kinetic-scroll';
export { storeIsReadable } from '$lib/store';
export { default as Section } from './panel/ui/Section.svelte';
export { default as Row } from './panel/ui/Row.svelte';
export { default as Icon } from './features/controls/ui/Icon.svelte';
export { default as ContentTile } from './features/controls/ui/ContentTile.svelte';
export { default as Choice } from './features/plugins/ui/Choice.svelte';
export { isRecord } from './features/automation/plain-data';
export { emptyScenario } from './features/automation/scenario';
export { ActionFailure } from './features/automation/action-failure';
export { progressAt } from './features/media/now-playing';
export { commit } from './features/layout/history.svelte';
export { currentRuntime } from './app/runtime/session.svelte';
export { ownerAction, whileOwner } from './plugins/owner';
export {
  callPlugin,
  emitPluginEvent,
  onPluginEvent,
  pluginStateHub,
  providePlugin,
} from './platform/plugin-host';
export {
  pluginAutomation,
  pluginHttp,
  pluginOAuth,
  pluginOpen,
  pluginPipe,
  pluginProcess,
  pluginSecrets,
  pluginSignIn,
  pluginStorage,
} from './platform/plugin-native';
export { nativeSessions } from './platform/media';
export { toast } from 'svelte-sonner';

export type { NowPlayingSession, Plugin, PluginApi } from './features/plugins/contracts';
export type { ControlConfig } from './features/controls/model';
export type { PluginService } from './platform/plugin-host';
export type {
  PluginAutomationSnapshot,
  PluginFile,
  PluginHttpRequest,
  PluginHttpResponse,
  PluginPipeEvent,
  PluginProcessEvent,
  PluginProcessOutput,
  PluginSecret,
} from './platform/plugin-native';

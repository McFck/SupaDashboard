import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
import { get } from 'svelte/store';
import { toast } from 'svelte-sonner';
import { approvePluginPermissions } from '../../platform/plugin-host';
import type { NativePlugin } from './external/load';
import { permissionRows } from './permissions';
import { nativePlugins, pluginState, setPluginEnabled } from './registry';

function dismissalKey(plugin: NativePlugin) {
  return `plugin-permissions:${plugin.id}:${JSON.stringify(plugin.consent?.added)}`;
}

export async function reviewPluginPermissions(plugin: NativePlugin) {
  const { consent, id, version } = plugin;
  if (!consent) {
    return;
  }
  const approved = await confirm({
    title: `New permissions for ${id} ${version}`,
    action: 'Approve',
    cancel: 'Keep disabled',
    details: permissionRows(consent.permissions, true),
  });
  if (!approved) {
    sessionStorage.setItem(dismissalKey(plugin), '1');
    return;
  }
  try {
    await approvePluginPermissions(id, consent.added);
    if (plugin.trust !== 'dev' && get(pluginState).uninstalled.includes(id)) {
      await setPluginEnabled(id, true);
    } else {
      location.reload();
    }
  } catch (error) {
    console.error(error);
    toast.error('Could not approve plugin permissions');
  }
}

export function promptForPluginPermissions() {
  for (const plugin of nativePlugins.values()) {
    if (plugin.consent && !sessionStorage.getItem(dismissalKey(plugin))) {
      void reviewPluginPermissions(plugin);
    }
  }
}

import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
import { untrack } from 'svelte';
import { toast } from 'svelte-sonner';
import { approvePluginPermissions } from '../../platform/plugin-host';
import type { NativePlugin } from './external/load';
import { permissionRows } from './permissions';
import { nativePlugins, refreshPlugins, setPluginEnabled } from './lifecycle';

const reviewing = new Set<string>();

function dismissalKey(plugin: NativePlugin) {
  return `plugin-permissions:${plugin.id}:${JSON.stringify(plugin.consent?.added)}`;
}

export async function reviewPluginPermissions(plugin: NativePlugin) {
  const { consent, id, version } = plugin;
  const key = dismissalKey(plugin);
  if (!consent || reviewing.has(key)) {
    return;
  }
  reviewing.add(key);
  try {
    const approved = await confirm({
      title: `New permissions for ${id} ${version}`,
      action: 'Approve',
      cancel: 'Keep disabled',
      details: permissionRows(consent.permissions, true),
    });
    if (!approved) {
      sessionStorage.setItem(key, '1');
      return;
    }
    await approvePluginPermissions(id, consent.added);
    if (!plugin.enabled) {
      await setPluginEnabled(id, true);
    } else {
      await refreshPlugins();
    }
  } catch (error) {
    console.error(error);
    toast.error('Could not approve plugin permissions');
  } finally {
    reviewing.delete(key);
  }
}

export function promptForPluginPermissions() {
  for (const plugin of nativePlugins.values()) {
    if (plugin.consent && !sessionStorage.getItem(dismissalKey(plugin))) {
      untrack(() => {
        void reviewPluginPermissions(plugin);
      });
    }
  }
}

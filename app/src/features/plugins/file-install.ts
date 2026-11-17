// Installing a `.sdplugin` the user picked, dropped or opened from Explorer: always behind a confirmation that names
// the plugin, its author and what it may reach natively. Release builds refuse unsigned files at inspection.
import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
import { inspectPluginFile, installPluginFile } from '../../platform/plugin-host';
import { isRecord } from '../automation/plain-data';
import { permissionRows, pluginPermissions } from './permissions';
import { PLUGIN_ID } from './plugin-store';

/** Inspects and confirms the file, then installs those exact bytes; the installed id, or null when declined. */
export async function installPluginFromFile(path: string): Promise<string | null> {
  const raw = await inspectPluginFile(path);
  const permissions = isRecord(raw) ? pluginPermissions(raw.permissions) : null;
  if (
    !isRecord(raw) ||
    !permissions ||
    typeof raw.id !== 'string' ||
    !PLUGIN_ID.test(raw.id) ||
    typeof raw.version !== 'string' ||
    (raw.trust !== 'verified' && raw.trust !== 'unverified') ||
    typeof raw.sha256 !== 'string'
  ) {
    throw new Error('Invalid plugin file');
  }
  const author = raw.trust === 'verified' ? 'SupaDashboard' : 'Unverified';
  const confirmed = await confirm({
    title: `Install ${raw.id} ${raw.version}?`,
    action: 'Install',
    details: [{ label: 'Author', value: author }, ...permissionRows(permissions)],
  });
  return confirmed ? installPluginFile(raw.sha256) : null;
}

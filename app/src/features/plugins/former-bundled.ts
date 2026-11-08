// Plugins that shipped inside the app before they moved to the catalogue. Users who had them get them back.
import type { PluginState } from './plugin-store';

const FORMER_BUNDLED = ['spotify', 'discord', 'haptics', 'subway'];

/**
 * Former bundled plugins to install from the catalogue: the user had one (an installation date), did not remove
 * it, and it is neither on disk nor compiled in (`present`). Nothing records an attempt, so a failure retries.
 */
export function formerBundledDue(state: PluginState, present: ReadonlySet<string>) {
  return FORMER_BUNDLED.filter(
    (id) => state.installed[id] && !state.uninstalled.includes(id) && !present.has(id),
  );
}

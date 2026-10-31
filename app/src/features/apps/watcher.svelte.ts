import { untrack } from 'svelte';
import type { VariableStore, VariableType, VariableValue } from '../automation/variables';
import { appsLink, type AppsLink, type WatchedApp } from '../../platform/apps';
import { settings } from '../settings/state.svelte';
import { watchedKeys } from './keys';

const OWNER = 'core-apps';
const FIELDS: readonly [keyof WatchedApp & string, VariableType, VariableValue][] = [
  ['running', 'boolean', false],
  ['focused', 'boolean', false],
  ['minimized', 'boolean', false],
  ['visible', 'boolean', false],
  ['display', 'string', ''],
];

type Host = {
  variables: VariableStore;
  /** The app keys to watch; read inside an effect, so a change re-syncs. */
  keys(): string[];
  link(onState: (apps: WatchedApp[]) => void, onError: () => void): AppsLink;
  onError(): void;
};

/** Keeps the read-only `app.<name>.<state>` variables in step with the native watcher, for the owner window only. */
export class AppWatcher {
  private readonly link: AppsLink;
  private readonly stopEffect: () => void;
  private watched = '';

  constructor(private readonly host: Host) {
    this.link = host.link(
      (apps) => this.apply(apps),
      () => host.onError(),
    );
    this.stopEffect = $effect.root(() => {
      $effect(() => {
        const keys = [...host.keys()].sort();
        untrack(() => this.sync(keys));
      });
    });
  }

  private sync(keys: string[]) {
    const next = JSON.stringify(keys);
    if (next !== this.watched) {
      this.watched = next;
      this.link.watch(keys);
    }
  }

  private apply(apps: WatchedApp[]) {
    const { variables } = this.host;
    try {
      for (const app of apps) {
        for (const [field, type, initialValue] of FIELDS) {
          const id = `app.${app.slug}.${field}`;
          if (!variables.get(id)) {
            variables.define(
              { id, name: id, type, owner: OWNER, persistent: false, readOnly: true, initialValue },
              OWNER,
            );
          }
          variables.set(id, app[field], OWNER);
        }
      }
    } catch {
      // A user variable already took a name such as `app.discord.running`.
      this.host.onError();
    }
  }

  destroy() {
    this.stopEffect();
    this.link.stop();
  }
}

/** Starts watching the apps settings refer to; returns the stop function. */
export function startAppWatcher(variables: VariableStore, onError: () => void) {
  const watcher = new AppWatcher({
    variables,
    keys: () => watchedKeys(settings.controls, settings.apps),
    link: appsLink,
    onError,
  });
  return () => watcher.destroy();
}

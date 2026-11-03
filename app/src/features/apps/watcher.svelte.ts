import { untrack } from 'svelte';
import type { VariableStore, VariableType, VariableValue } from '../automation/variables';
import {
  appsLink,
  type AppsLink,
  type WatchedApp,
  type AppWindowSelection,
} from '../../platform/apps';
import { settings } from '../settings/state.svelte';
import { appVariable, watchedKeys, watchedSelections, windowState, type AppField } from './keys';

const OWNER = 'core-apps';
const FIELDS: readonly [AppField, VariableType, VariableValue][] = [
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
  selections?(): AppWindowSelection[];
  link(onState: (apps: WatchedApp[]) => void, onError: () => void): AppsLink;
  onError(): void;
};

/** Keeps the read-only `app.<name>.<state>` variables in step with the native watcher, for the owner window only. */
export class AppWatcher {
  private readonly link: AppsLink;
  private readonly stopEffect: () => void;
  private watched = '';
  /** The variables this watcher defined, so apps that leave the set can be retired. */
  private readonly defined = new Set<string>();

  constructor(private readonly host: Host) {
    this.link = host.link(
      (apps) => this.apply(apps),
      () => host.onError(),
    );
    this.stopEffect = $effect.root(() => {
      $effect(() => {
        const keys = [...host.keys()].sort();
        const selections = host.selections?.() ?? [];
        untrack(() => this.sync(keys, selections));
      });
    });
  }

  private sync(keys: string[], selections: AppWindowSelection[]) {
    const next = JSON.stringify({ keys, selections });
    if (next !== this.watched) {
      this.watched = next;
      this.link.watch(keys, selections);
      if (!keys.length) {
        this.apply([]);
      }
    }
  }

  private apply(apps: WatchedApp[]) {
    const { variables } = this.host;
    const present = new Set<string>();
    try {
      for (const app of apps) {
        for (const [field, type, initialValue] of FIELDS) {
          if (app.selection && !windowState(field)) {
            continue;
          }
          const id = appVariable(app.slug, field, app.selection);
          if (!variables.get(id)) {
            variables.define(
              { id, name: id, type, owner: OWNER, persistent: false, readOnly: true, initialValue },
              OWNER,
            );
          }
          variables.set(id, app[field], OWNER);
          present.add(id);
          this.defined.add(id);
        }
      }
      // An app that left the watched set must not keep its last values; its variables become unavailable.
      for (const id of this.defined) {
        if (!present.has(id)) {
          variables.remove(id, OWNER);
          this.defined.delete(id);
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
    this.apply([]);
  }
}

/** Starts watching the apps settings refer to; returns the stop function. */
export function startAppWatcher(variables: VariableStore, onError: () => void) {
  const watcher = new AppWatcher({
    variables,
    keys: () => watchedKeys(settings.controls, settings.apps),
    selections: () => watchedSelections(settings.controls),
    link: appsLink,
    onError,
  });
  return () => watcher.destroy();
}

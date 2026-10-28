import { isTauri } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { toast } from 'svelte-sonner';
import { storeIsReadable } from '$lib/store';
import { newId } from '../../features/automation/scenario';
import { VariableStore } from '../../features/automation/variables';

export type VariablePersistence = {
  save(envelope: ReturnType<VariableStore['serializePersistent']>): Promise<void>;
};

const VARIABLE_KEY = 'supadashboard:variables:v1';
const SAVE_DELAY_MS = 200;

/** Saves the persistent variables shortly after the last change, so a burst of edits writes once. */
export class VariableSaver {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly variables: VariableStore,
    private readonly persistence: VariablePersistence | undefined,
  ) {}

  schedule() {
    if (!this.persistence) {
      return;
    }
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, SAVE_DELAY_MS);
  }

  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  async flush() {
    try {
      await this.persistence?.save(this.variables.serializePersistent());
    } catch {
      /* persistence errors are surfaced by the owner boot adapter */
    }
  }
}

export async function loadVariableState(): Promise<{
  variables: VariableStore;
  persistence: VariablePersistence;
}> {
  let raw: unknown;
  let envelope: unknown;
  let store: Awaited<ReturnType<typeof load>> | undefined;
  let unreadable = false;
  let corruptJson = false;
  try {
    if (isTauri()) {
      store = await load('variables.json', { defaults: {}, autoSave: false });
      raw = envelope = await store.get('variables');
      corruptJson = raw === null;
      unreadable = raw === undefined && !(await storeIsReadable(store));
    } else {
      raw = localStorage.getItem(VARIABLE_KEY);
      try {
        envelope = raw === null ? undefined : JSON.parse(raw as string);
        corruptJson = raw !== null && envelope === null;
      } catch {
        corruptJson = true;
      }
    }
  } catch {
    unreadable = true;
  }

  const variables = new VariableStore(envelope);
  let recovery = variables.needsRecovery || corruptJson;
  const recoveryKey = `variables.recovery:${newId()}`;
  if (unreadable || recovery) {
    toast.error('Could not load saved variables');
  }

  let writing = Promise.resolve();
  const persistence: VariablePersistence = {
    save(envelope) {
      const write = async () => {
        if (unreadable) {
          throw new Error('Variable saving is disabled because the original could not be read');
        }
        if (store) {
          if (recovery) {
            await store.set(recoveryKey, raw);
          }
          await store.set('variables', envelope);
          await store.save();
        } else {
          if (recovery) {
            localStorage.setItem(`${VARIABLE_KEY}:${recoveryKey}`, raw as string);
          }
          localStorage.setItem(VARIABLE_KEY, JSON.stringify(envelope));
        }
        recovery = false;
      };
      // Failed writes must not poison the queue or let older snapshots finish last.
      writing = writing.then(write, write).catch((error) => {
        toast.error('Could not save variables', { id: 'variables-save' });
        throw error;
      });
      return writing;
    },
  };
  return { variables, persistence };
}

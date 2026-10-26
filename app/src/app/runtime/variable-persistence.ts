import { isTauri } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { VariableStore } from '../../features/automation/variables';

export type VariablePersistence = {
  save(envelope: ReturnType<VariableStore['serializePersistent']>): Promise<void>;
};

const VARIABLE_KEY = 'supadashboard:variables:v1';

export async function loadVariableState(): Promise<{
  variables: VariableStore;
  persistence: VariablePersistence;
}> {
  if (isTauri()) {
    const store = await load('variables.json', { defaults: {}, autoSave: false });
    const variables = new VariableStore(await store.get('variables'));
    return {
      variables,
      persistence: {
        save: async (envelope) => {
          await store.set('variables', envelope);
          await store.save();
        },
      },
    };
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(localStorage.getItem(VARIABLE_KEY) ?? 'null');
  } catch {
    envelope = null;
  }
  let variables: VariableStore;
  try {
    variables = new VariableStore(envelope);
  } catch {
    variables = new VariableStore();
  }
  return {
    variables,
    persistence: {
      save: async (value) => localStorage.setItem(VARIABLE_KEY, JSON.stringify(value)),
    },
  };
}

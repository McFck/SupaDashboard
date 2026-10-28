import type { Store } from '@tauri-apps/plugin-store';

/** plugin-store opens an unparseable file as empty, so a later save would replace it; only reload reports it. */
export async function storeIsReadable(store: Store) {
  try {
    await store.reload();
    return true;
  } catch (error) {
    // A missing file (first run) fails to reload too; only a parse failure means saved data exists.
    return !String(error).startsWith('Failed to deserialize store');
  }
}

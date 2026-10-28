import { settings } from '../../features/settings/state.svelte';
import { setVariableMirror } from '../../features/plugins/registry';
import { validSnapshot, type RuntimeRequest } from './protocol';
import type { RuntimeSync } from './transport';
import { EMPTY, runtimeView } from './state';

let clientSync: RuntimeSync | undefined;
let remoteRevision = 0;

export function setRuntimeSync(sync: RuntimeSync) {
  clientSync = sync;
  return () => {
    if (clientSync === sync) clientSync = undefined;
  };
}

export function acceptRuntimeSnapshot(value: unknown, revision: number) {
  if (!validSnapshot(value) || !Number.isSafeInteger(revision) || revision <= remoteRevision) {
    return;
  }
  remoteRevision = revision;
  setVariableMirror(Object.values(value.variables.records));
  settings.deck.activePage = value.activePage;
  runtimeView.set({
    ...value,
    content: value.content && typeof value.content === 'object' ? value.content : {},
    online: true,
    owner: false,
    revision,
  });
}

export async function attachRuntimeConnection(sync: RuntimeSync) {
  const detach = setRuntimeSync(sync);
  remoteRevision = 0;
  runtimeView.set(EMPTY);
  try {
    acceptRuntimeSnapshot(await sync.request({ type: 'snapshot' }), sync.currentRevision);
  } catch {
    runtimeView.set(EMPTY);
  }
  return () => {
    detach();
    sync.close();
    runtimeView.set(EMPTY);
  };
}

export async function requestRuntime(request: RuntimeRequest) {
  if (!clientSync) throw new Error('Runtime owner is unavailable');
  return clientSync.request(request);
}

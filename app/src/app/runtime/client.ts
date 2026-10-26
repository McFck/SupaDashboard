import { settings } from '../../features/settings/state.svelte';
import { setVariableMirror } from '../../features/plugins/registry';
import type { RuntimeRequest, RuntimeSync } from './sync';
import { EMPTY, runtimeView, type RuntimeSnapshot } from './state';

let clientSync: RuntimeSync | undefined;
let remoteRevision = 0;

export function setRuntimeSync(sync: RuntimeSync) {
  clientSync = sync;
  return () => {
    if (clientSync === sync) clientSync = undefined;
  };
}

export function acceptRuntimeSnapshot(snapshot: unknown, revision: number) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !Number.isSafeInteger(revision) ||
    revision <= remoteRevision
  )
    return;
  const value = snapshot as RuntimeSnapshot;
  if (
    typeof value.activePage !== 'string' ||
    !value.variables ||
    typeof value.variables !== 'object' ||
    !value.busy ||
    typeof value.busy !== 'object'
  )
    return;
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
  runtimeView.set({ ...EMPTY, online: false, owner: false });
  try {
    acceptRuntimeSnapshot(await sync.request({ type: 'snapshot' }), sync.currentRevision);
  } catch {
    runtimeView.set({ ...EMPTY, online: false, owner: false });
  }
  return () => {
    detach();
    sync.close();
    runtimeView.set({ ...EMPTY, online: false, owner: false });
  };
}

export function receiveRuntimeSnapshot(snapshot: unknown, revision: number) {
  acceptRuntimeSnapshot(snapshot, revision);
}

export async function requestRuntime(request: RuntimeRequest) {
  if (!clientSync) throw new Error('Runtime owner is unavailable');
  return clientSync.request(request);
}

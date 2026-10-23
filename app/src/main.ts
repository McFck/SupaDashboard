import { mount, tick } from 'svelte';
import { get } from 'svelte/store';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toast } from 'svelte-sonner';
import './app.css';
import { actions, install, installEnabled } from './core/registry';
import { redo, startHistory, undo } from './core/history.svelte';
import { loadSettings, settings } from './core/settings.svelte';
import { initVolumeSync } from './core/volume';
import { followRemovals } from './controls/removal';
import { attachRuntimeConnection, bootRuntime, receiveRuntimeSnapshot, runtimeView, setRuntimeSync,
  type AutomationRuntime } from './core/runtime.svelte';
import { browserRuntimeLease, openRuntimeSync, type RuntimeRequest, type RuntimeSync } from './core/runtime-sync';
import { TRIGGERS, type Trigger } from './core/scenario';
import type { VariableType, VariableValue } from './core/variables';
import { corePlugin } from './plugins/core';
import { spotifyPlugin } from './plugins/spotify';
import { subwayPlugin } from './plugins/subway';
import { uiPlugin } from './plugins/ui';
import Root from './Root.svelte';

document.addEventListener('contextmenu', event => event.preventDefault());

// One bundle, two windows: the transparent dashboard ("main") and the control panel ("panel").
const label = (() => { try { return getCurrentWindow().label; } catch { return new URLSearchParams(location.search).get('view') ?? 'main'; } })();
const view = label === 'panel' ? 'panel' : 'dashboard';
document.documentElement.classList.toggle('transparent', view === 'dashboard');

const native = isTauri();
let sync: RuntimeSync | undefined;
let releaseClient: (() => void) | undefined;
let stopClient: (() => void) | undefined;
let stopLease: (() => Promise<void>) | undefined;
let disposeOwner: (() => Promise<void>) | undefined;
let cleanupPromise: Promise<void> | undefined;
let bootDisposed = false;

function reportRuntimeFailure(failure: import('./core/scenario-runner').ScenarioFailure) {
  const control = settings.controls.find(item => item.id === failure.controlId);
  const action = failure.actionId ? actions.get(failure.actionId)?.title ?? failure.actionId : undefined;
  toast.error(`${control?.name ?? 'Automation'}: ${action ?? (failure.kind === 'delay' ? 'Wait' : 'Condition')} failed`);
}

function validRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function handleRuntimeRequest(runtime: AutomationRuntime, request: RuntimeRequest) {
  const payload = validRecord(request.payload) ? request.payload : {};
  if (request.type === 'snapshot') return get(runtime.snapshots);
  if (request.type === 'simulate') {
    const controlId = payload.controlId, trigger = payload.trigger ?? 'press', itemId = payload.itemId ?? '';
    if (typeof controlId !== 'string' || typeof itemId !== 'string' || itemId.length > 128 || !TRIGGERS.includes(trigger as Trigger))
      throw new Error('Invalid simulation request');
    return runtime.simulate(controlId, trigger as Trigger, itemId, { notify: false });
  }
  if (request.type === 'emitEvent') {
    const eventId = payload.eventId, parameter = payload.parameter;
    if (typeof eventId !== 'string' || eventId.length > 256 || parameter !== undefined &&
      (typeof parameter !== 'string' || parameter.length > 256)) throw new Error('Invalid event request');
    await runtime.emitEvent(eventId, parameter as string | undefined);
    return get(runtime.snapshots);
  }
  if (request.type === 'stop') {
    if (typeof payload.controlId !== 'string') throw new Error('Invalid stop request');
    await runtime.stopControl(payload.controlId);
    return { stopped: true };
  }
  if (request.type === 'setVariable') {
    if (typeof payload.id !== 'string' || (typeof payload.value !== 'boolean' && typeof payload.value !== 'number' && typeof payload.value !== 'string'))
      throw new Error('Invalid variable request');
    await runtime.setVariable(payload.id, payload.value as VariableValue);
    return get(runtime.snapshots);
  }
  if (request.type === 'createVariable') {
    const { name, type, initialValue } = payload;
    if (typeof name !== 'string' || !['boolean', 'integer', 'float', 'string'].includes(String(type))) throw new Error('Invalid variable definition');
    runtime.variables.createUser({ id: `user:${crypto.randomUUID()}`, name, type: type as VariableType,
      initialValue: initialValue as VariableValue });
    return get(runtime.snapshots);
  }
  if (request.type === 'renameVariable') {
    if (typeof payload.id !== 'string' || typeof payload.name !== 'string') throw new Error('Invalid variable request');
    runtime.variables.rename(payload.id, payload.name);
    return get(runtime.snapshots);
  }
  if (request.type === 'setVariablePersistence') {
    if (typeof payload.id !== 'string' || typeof payload.persistent !== 'boolean') throw new Error('Invalid variable request');
    runtime.variables.setPersistent(payload.id, payload.persistent);
    return get(runtime.snapshots);
  }
  if (request.type === 'deleteVariable') {
    if (typeof payload.id !== 'string') throw new Error('Invalid variable request');
    runtime.variables.remove(payload.id);
    return get(runtime.snapshots);
  }
  throw new Error('Unknown runtime request');
}

async function startOwner(syncClient: RuntimeSync) {
  const { runtime, dispose } = await bootRuntime({ owner: true, onFailure: reportRuntimeFailure,
    onQueueFull: (controlId, trigger) => toast.warning(`${settings.controls.find(item => item.id === controlId)?.name ?? 'Automation'} · ${trigger} queue is full`) });
  syncClient.becomeOwner(request => handleRuntimeRequest(runtime, request));
  const unsubscribe = runtime.snapshots.subscribe(snapshot => syncClient.publish(snapshot));
  return async () => {
    unsubscribe();
    syncClient.releaseOwnership();
    await dispose();
  };
}

async function startRuntimeServices() {
  const sourceId = native ? view === 'panel' ? 'panel' : 'main' : undefined;
  sync = await openRuntimeSync(sourceId, { onSnapshot: receiveRuntimeSnapshot,
    onAvailability: online => { if (!online) runtimeView.set({ ...get(runtimeView), online: false }); } });
  if (view === 'panel') {
    void attachRuntimeConnection(sync).then(disconnect => { releaseClient = disconnect; }).catch(() => {});
    return;
  }
  releaseClient = setRuntimeSync(sync);
  if (native) {
    disposeOwner = await startOwner(sync);
    return;
  }
  const lease = browserRuntimeLease(async () => { disposeOwner = await startOwner(sync!); }, async () => {
    await disposeOwner?.();
    disposeOwner = undefined;
  });
  stopLease = lease.stop;
}

function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    await stopLease?.();
    await disposeOwner?.();
    disposeOwner = undefined;
    releaseClient?.();
    releaseClient = undefined;
    sync?.close();
    sync = undefined;
  })();
  return cleanupPromise;
}
window.addEventListener('pagehide', () => { bootDisposed = true; void cleanup(); }, { once: true });
if (import.meta.hot) import.meta.hot.dispose(() => { bootDisposed = true; void cleanup(); });

async function boot() {
  let panelGeneration: number | undefined;
  if (native && view === 'panel') {
    try {
      const bootstrap = await invoke<{ generation: number }>('panel_bootstrap');
      if (Number.isSafeInteger(bootstrap?.generation) && bootstrap.generation >= 0) panelGeneration = bootstrap.generation;
      else console.warn('panel bootstrap returned an invalid generation');
    } catch (error) {
      console.warn('panel bootstrap', error);
    }
  }
  if (bootDisposed) return;
  const all = [corePlugin, uiPlugin, spotifyPlugin, subwayPlugin];
  try {
    await installEnabled(...all);
  } catch (e) {
    console.warn('plugins', e);
    install(...all);
  }
  try { await loadSettings(); } catch (e) { console.warn('settings', e); }
  if (view === 'panel') {
    void initVolumeSync().catch(error => console.warn('volume sync', error));
  } else {
    try { await initVolumeSync(); } catch (e) { console.warn('volume sync', e); }
  }
  if (bootDisposed) return;
  void startRuntimeServices().catch(error => console.warn('automation runtime', error));
  if (view === 'panel') {
    startHistory();
    document.addEventListener('keydown', event => {
      if (!event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      }
    });
  }
  followRemovals();
  mount(Root, { target: document.getElementById('app')!, props: { view } });
  await tick();
  if (!bootDisposed && native && view === 'panel' && panelGeneration !== undefined) {
    try { await invoke('panel_ready', { generation: panelGeneration }); }
    catch (error) { console.warn('panel ready', error); }
  }
}
void boot();

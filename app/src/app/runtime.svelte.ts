export { RuntimeSession as AutomationRuntime, type RuntimeOptions } from './runtime/session.svelte';
export {
  bootRuntime,
  currentRuntime,
  stopRuntime,
  type RuntimeHandle as RuntimeSingleton,
} from './runtime/lifecycle';
export {
  captureRuntimeTrigger,
  dispatchRuntimePacket,
  dispatchRuntimeTrigger,
  requestPageChange,
  simulateRuntimeEvent,
  stopRuntimeControl,
} from './runtime/commands';
export {
  acceptRuntimeSnapshot,
  attachRuntimeConnection,
  receiveRuntimeSnapshot,
  requestRuntime,
  setRuntimeSync,
} from './runtime/client';
export { runtimeView, type RuntimeSnapshot } from './runtime/state';
export { loadVariableState, type VariablePersistence } from './runtime/variable-persistence';
export type { PageChangeReason } from '../features/layout/page-controller';

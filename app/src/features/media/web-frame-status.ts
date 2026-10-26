import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export const WEB_FRAME_TIMEOUT_MS = 15_000;
export type FramePhase = 'starting' | 'completed' | 'destroyed';
export type FrameNavigation = {
  frameKey: string;
  navigationId: number;
  phase: FramePhase;
  success?: boolean;
  error?: string;
};
export type WebFrameStatus = 'loading' | 'ready' | 'unavailable';
export type WebFrameState = {
  frameKey: string;
  navigationId?: number;
  status: WebFrameStatus;
  domLoaded: boolean;
};

export function initialWebFrameState(frameKey: string): WebFrameState {
  return { frameKey, status: 'loading', domLoaded: false };
}

export function reduceWebFrameState(state: WebFrameState, event: FrameNavigation): WebFrameState {
  if (event.frameKey !== state.frameKey) return state;
  if (event.phase === 'destroyed') return { ...state, status: 'unavailable' };
  if (event.phase === 'starting')
    return { ...state, navigationId: event.navigationId, status: 'loading', domLoaded: false };
  if (event.navigationId !== state.navigationId) return state;
  return { ...state, status: event.success ? 'ready' : 'unavailable' };
}

export function reduceWebFrameDomLoad(state: WebFrameState, nativeStatus: boolean): WebFrameState {
  return { ...state, domLoaded: true, status: nativeStatus ? state.status : 'ready' };
}

export function consumeEligibleTime(remaining: number, elapsed: number) {
  return Math.max(0, remaining - Math.max(0, Number.isFinite(elapsed) ? elapsed : 0));
}

type FrameStatusAdapter = {
  subscribe(listener: (event: FrameNavigation) => void): Promise<() => void> | (() => void);
};
type FrameWindow = typeof globalThis & { __supadashboardContentFrameAdapter?: FrameStatusAdapter };
const subscribers = new Set<(event: FrameNavigation) => void>();
let references = 0;
let connection: Promise<boolean> | undefined;
let stopConnection: (() => void) | undefined;

function validEvent(value: unknown): value is FrameNavigation {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.frameKey === 'string' &&
    typeof event.navigationId === 'number' &&
    Number.isSafeInteger(event.navigationId) &&
    (event.phase === 'starting' || event.phase === 'completed' || event.phase === 'destroyed')
  );
}

function publish(event: unknown) {
  if (validEvent(event)) for (const subscriber of subscribers) subscriber(event);
}

function connect(): Promise<boolean> {
  if (connection) return connection;
  connection = (async () => {
    try {
      if (isTauri()) {
        const window = getCurrentWindow();
        const unlisten = await window.listen<FrameNavigation>('content-frame-navigation', (event) =>
          publish(event.payload),
        );
        stopConnection = unlisten;
        return (await invoke<boolean>('content_frames_ready')) === true;
      }
      const adapter = (globalThis as FrameWindow).__supadashboardContentFrameAdapter;
      if (adapter) {
        stopConnection = await adapter.subscribe(publish);
        return true;
      }
    } catch {
      stopConnection?.();
      stopConnection = undefined;
    }
    return false;
  })();
  return connection;
}

export async function subscribeWebFrameEvents(listener: (event: FrameNavigation) => void) {
  references++;
  subscribers.add(listener);
  const nativeStatus = await connect();
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    subscribers.delete(listener);
    references = Math.max(0, references - 1);
    if (references === 0) {
      void connection?.then(() => {
        if (references !== 0) return;
        stopConnection?.();
        stopConnection = undefined;
        connection = undefined;
      });
    }
  };
  return { nativeStatus, dispose };
}

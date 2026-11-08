import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isRecord } from '../automation/plain-data';

export const WEB_FRAME_TIMEOUT_MS = 15_000;
export type FrameNavigation = {
  frameKey: string;
  navigationId: number;
} & (
  | { phase: 'starting' | 'destroyed'; success?: never; error?: never }
  | { phase: 'completed'; success: boolean; error?: string }
);
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

const subscribers = new Set<(event: FrameNavigation) => void>();
let connection: Promise<boolean> | undefined;
let stopConnection: (() => void) | undefined;

function validEvent(value: unknown): value is FrameNavigation {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.frameKey !== 'string' ||
    !value.frameKey.startsWith('content:') ||
    value.frameKey.length <= 'content:'.length ||
    /\s/.test(value.frameKey) ||
    typeof value.navigationId !== 'number' ||
    !Number.isSafeInteger(value.navigationId) ||
    value.navigationId < 0
  ) {
    return false;
  }
  if (value.phase === 'completed') {
    return (
      typeof value.success === 'boolean' &&
      (value.error === undefined || (typeof value.error === 'string' && !value.success))
    );
  }
  return (
    (value.phase === 'starting' || value.phase === 'destroyed') &&
    value.success === undefined &&
    value.error === undefined
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
        const unlisten = await window.listen<unknown>('content-frame-navigation', (event) =>
          publish(event.payload),
        );
        stopConnection = unlisten;
        return (await invoke<boolean>('content_frames_ready')) === true;
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
  subscribers.add(listener);
  const nativeStatus = await connect();
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    subscribers.delete(listener);
    if (subscribers.size === 0) {
      void connection?.then(() => {
        if (subscribers.size !== 0) return;
        stopConnection?.();
        stopConnection = undefined;
        connection = undefined;
      });
    }
  };
  return { nativeStatus, dispose };
}

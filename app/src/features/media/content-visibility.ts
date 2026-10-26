import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { writable } from 'svelte/store';

export const mediaContentPages = writable<ReadonlySet<string>>(new Set());

export function setMediaContentPages(pageIds: Iterable<string>) {
  mediaContentPages.set(new Set(pageIds));
}

export type ContentVisibility = {
  runtimeOwner: boolean;
  editing: boolean;
  pageVisible: boolean;
  intersecting: boolean;
  documentVisible: boolean;
  dashboardVisible: boolean;
};

export type DashboardVisibilityBridge = {
  listen(callback: (visible: boolean) => void): Promise<() => void>;
  isVisible(): Promise<boolean>;
};

export function canRunContent(value: ContentVisibility) {
  return value.runtimeOwner && !value.editing && value.pageVisible && value.intersecting &&
    value.documentVisible && value.dashboardVisible;
}

export function watchIntersection(node: Element, onChange: (intersecting: boolean) => void,
  createObserver?: (callback: IntersectionObserverCallback) => IntersectionObserver) {
  if (!createObserver && typeof IntersectionObserver === 'undefined') {
    onChange(true);
    return () => {};
  }
  const observer = (createObserver ?? (callback => new IntersectionObserver(callback, { threshold: 0 })))(
    entries => onChange(!!entries[0]?.isIntersecting));
  observer.observe(node);
  return () => observer.disconnect();
}

function tauriBridge(): DashboardVisibilityBridge {
  const window = getCurrentWindow();
  return {
    listen: callback => window.listen<{ visible: boolean }>('dashboard-visibility', event => callback(event.payload.visible)),
    isVisible: () => window.isVisible(),
  };
}

export async function watchDashboardVisibility(onChange: (visible: boolean) => void,
  bridge?: DashboardVisibilityBridge) {
  if (!bridge && !isTauri()) {
    onChange(true);
    return () => {};
  }
  const source = bridge ?? tauriBridge();
  let active = true;
  let eventRevision = 0;
  const unlisten = await source.listen(visible => {
    eventRevision++;
    if (active) onChange(visible);
  });
  const queryRevision = eventRevision;
  try {
    const visible = await source.isVisible();
    if (active && eventRevision === queryRevision) onChange(visible);
  } catch {
    // The window event is still authoritative if the initial query fails.
  }
  return () => {
    active = false;
    unlisten();
  };
}

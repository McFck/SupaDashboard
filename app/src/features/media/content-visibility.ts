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

export function canRunContent(value: ContentVisibility) {
  return (
    value.runtimeOwner &&
    !value.editing &&
    value.pageVisible &&
    value.intersecting &&
    value.documentVisible &&
    value.dashboardVisible
  );
}

export function watchIntersection(node: Element, onChange: (intersecting: boolean) => void) {
  if (typeof IntersectionObserver === 'undefined') {
    onChange(true);
    return () => {};
  }
  const observer = new IntersectionObserver((entries) => onChange(!!entries[0]?.isIntersecting), {
    threshold: 0,
  });
  observer.observe(node);
  return () => observer.disconnect();
}

export async function watchDashboardVisibility(onChange: (visible: boolean) => void) {
  if (!isTauri()) {
    onChange(true);
    return () => {};
  }
  const window = getCurrentWindow();
  let active = true;
  let eventRevision = 0;
  // Native emits can arrive out of order; an older revision than the last applied one is stale.
  let nativeRevision = -1;
  const unlisten = await window.listen<{ visible: boolean; revision: number }>(
    'dashboard-visibility',
    ({ payload }) => {
      if (payload.revision <= nativeRevision) return;
      nativeRevision = payload.revision;
      eventRevision++;
      if (active) onChange(payload.visible);
    },
  );
  const queryRevision = eventRevision;
  try {
    const visible = await window.isVisible();
    if (active && eventRevision === queryRevision) onChange(visible);
  } catch {
    // The window event is still authoritative if the initial query fails.
  }
  return () => {
    active = false;
    unlisten();
  };
}

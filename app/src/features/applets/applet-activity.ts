import { derived, writable, type Readable } from 'svelte/store';

const surfaces = writable(new Map<string, Set<object>>());

/** True while some mounted surface of the applet is live; the owner window's runtime reads it as `context.active`. */
export function appletActive(appletId: string): Readable<boolean> {
  return derived(surfaces, (map) => (map.get(appletId)?.size ?? 0) > 0);
}

/** Records whether `surface` is live; a surface that unmounts reports `false`. */
export function setSurfaceLive(appletId: string, surface: object, live: boolean) {
  surfaces.update((map) => {
    const set = map.get(appletId);
    if (live === (set?.has(surface) ?? false)) {
      return map;
    }
    const next = new Map(map);
    const nextSet = new Set(set);
    if (live) {
      nextSet.add(surface);
    } else {
      nextSet.delete(surface);
    }
    next.set(appletId, nextSet);
    return next;
  });
}

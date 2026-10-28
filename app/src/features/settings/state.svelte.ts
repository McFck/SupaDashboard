import type { Settings } from './schema';
import { DEFAULT_PAGE, DEFAULTS } from './defaults';

/** Serialize the live settings with a stable launch placeholder, never the runtime page selection. */
export function serializeSettings(source: Settings = $state.snapshot(settings)) {
  const snapshot = structuredClone(source);
  snapshot.deck.activePage = snapshot.deck.pages[0]?.id ?? DEFAULT_PAGE.id;
  return JSON.stringify(snapshot);
}

export const settings: Settings = $state(structuredClone(DEFAULTS));
export const controlById = (id: string) => settings.controls.find((c) => c.id === id);

export const newId = (prefix: string, taken: string[]) => {
  const base =
    prefix
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'item';
  let id = base,
    n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
};

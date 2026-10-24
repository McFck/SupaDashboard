// User settings: one reactive object per window, persisted with tauri-plugin-store and kept in sync between
// the dashboard and the control panel (both windows load the same store and listen for its changes).
import { load } from '@tauri-apps/plugin-store';
import { isTauri } from '@tauri-apps/api/core';
import type { ControlConfig } from './controls';
import { normalizeControl } from './scenario';
import type { DeckSizing, Item } from './layout';

export type Page = {
  id: string;
  name: string;
  rows: number;
  cols: number;
  /** Cell edge in px and spacing between cells. */
  size: number;
  sizing: DeckSizing;
  gap: number;
  items: Item[];
};

export type Deck = { pages: Page[]; activePage: string };

export type Settings = {
  version: 5;
  skin: string;
  display: {
    monitor: string | null;
    fullscreen: boolean;
    alwaysOnTop: boolean;
    /** Backdrop behind the widgets on the transparent dashboard window. */
    background: { color: string; opacity: number; radius: number };
  };
  controls: ControlConfig[];
  deck: Deck;
  pageRotation: { intervalSeconds: number };
  /** control id -> active variant (gesture swaps are sticky across restarts) */
  variants: Record<string, number>;
};

const swapVertical = { swipeDown: { variant: 'next' as const }, swipeUp: { variant: 'prev' as const } };
const media = (id: string, icon: string, name: string, color: string): ControlConfig => normalizeControl({
  id, name, type: 'button', gestures: swapVertical, variants: [
    { label: name, icon, color, action: { id: `media.${id}`, args: { source: 'system' } } },
    { label: name, icon, color: '#66ce8f', action: { id: `media.${id}`, args: { source: 'spotify' } } }],
});

const DEFAULT_PAGE: Page = {
  id: 'page-1', name: 'Page 1', rows: 3, cols: 6, size: 112, sizing: 'auto', gap: 14, items: [
    { id: 'i1', control: 'prev', x: 0, y: 0, w: 1, h: 1 },
    { id: 'i2', control: 'toggle', x: 1, y: 0, w: 1, h: 1 },
    { id: 'i3', control: 'next', x: 2, y: 0, w: 1, h: 1 },
    { id: 'i4', control: 'spotify', x: 3, y: 0, w: 1, h: 1 },
    { id: 'i5', control: 'mixer', x: 0, y: 1, w: 4, h: 2 },
    { id: 'i6', control: 'volume', x: 4, y: 0, w: 1, h: 3 },
  ],
};

export const DEFAULTS: Settings = {
  version: 5,
  skin: 'deck',
  display: { monitor: null, fullscreen: false, alwaysOnTop: false, background: { color: '#0a0a0a', opacity: 0.55, radius: 28 } },
  controls: [
    media('prev', 'SkipBack', 'Previous', '#67c9eb'),
    media('toggle', 'Play', 'Play / pause', '#e9c878'),
    media('next', 'SkipForward', 'Next', '#67c9eb'),
    normalizeControl({ id: 'volume', name: 'Volume', type: 'slider',
      gestures: { swipeLeft: { variant: 'next' }, swipeRight: { variant: 'prev' } }, variants: [
        { label: 'Volume', icon: 'Volume2', color: '#8ea8f0', value: { id: 'volume', args: { target: 'system' } } },
        { label: 'Spotify', icon: 'spotify', color: '#66ce8f', value: { id: 'volume', args: { target: 'spotify' } } }] }),
    normalizeControl({ id: 'mixer', name: 'Mixer', type: 'mixer', variants: [{ label: 'Mixer', color: '#b5a0e8' }], options: { channels: 'auto', max: 6, layout: 'auto' } }),
    normalizeControl({ id: 'spotify', name: 'Spotify', type: 'button',
      variants: [{ label: 'Spotify', icon: 'spotify', color: '#66ce8f', action: { id: 'spotify.open' } }] }),
  ],
  deck: { pages: [structuredClone(DEFAULT_PAGE)], activePage: DEFAULT_PAGE.id },
  pageRotation: { intervalSeconds: 0 },
  variants: {},
};

const validInterval = (value: unknown): value is number => Number.isSafeInteger(value) &&
  (value === 0 || (Number(value) >= 5 && Number(value) <= 3600));

function uniqueId(value: unknown, used: Set<string>, base: string) {
  if (typeof value === 'string' && value.trim() && !used.has(value)) {
    used.add(value);
    return value;
  }
  let index = 1, id = `${base}-${index}`;
  while (used.has(id)) id = `${base}-${++index}`;
  used.add(id);
  return id;
}

function normalizePage(raw: any, index: number, pageIds: Set<string>, itemIds: Set<string>): Page {
  const source = raw && typeof raw === 'object' ? raw : {};
  const fallback = DEFAULT_PAGE;
  const id = uniqueId(source.id, pageIds, 'page');
  const rows = Number.isSafeInteger(source.rows) && source.rows > 0 ? source.rows : fallback.rows;
  const cols = Number.isSafeInteger(source.cols) && source.cols > 0 ? source.cols : fallback.cols;
  const size = Number.isFinite(source.size) && source.size > 0 ? source.size : fallback.size;
  const gap = Number.isFinite(source.gap) && source.gap >= 0 ? source.gap : fallback.gap;
  const items = Array.isArray(source.items) ? source.items.flatMap((item: any) => {
    if (!item || typeof item !== 'object' || typeof item.control !== 'string' ||
      ![item.x, item.y, item.w, item.h].every(Number.isFinite) || item.w <= 0 || item.h <= 0) return [];
    return [{ ...item, id: uniqueId(item.id, itemIds, 'item') } as Item];
  }) : [];
  const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : `Page ${index + 1}`;
  return { id, name, rows, cols, size, gap, sizing: source.sizing === 'manual' ? 'manual' : 'auto', items };
}

/** Bring any saved settings up to the current version without losing the user's controls. */
export function migrate(input: any): Settings {
  const out = structuredClone(DEFAULTS);
  if (!input || typeof input !== 'object') return out;
  let saved = structuredClone(input);
  if (typeof saved.version === 'number' && saved.version > 5)
    throw new Error(`Settings version ${saved.version} is newer than this app supports`);
  if (saved.version === 1) {
    const icon: Record<string, string> = { prev: 'SkipBack', next: 'SkipForward', playpause: 'Play', volume: 'Volume2' };
    for (const c of saved.controls ?? []) {
      c.name ??= c.id;
      for (const v of c.variants ?? []) v.icon = icon[v.icon] ?? v.icon;
    }
    saved = { ...saved, version: 2, skin: saved.skin === 'classic' ? 'deck' : saved.skin, deck: null };
  }
  if (saved.version === 2) {
    // Media targets became plugin-provided sources; Spotify's app link became the Spotify plugin's action.
    const fix = (a: any) => {
      if (a?.id?.startsWith('media.')) a.args = { source: a.args?.target === 'spotify' ? 'spotify' : 'system' };
      if (a?.id === 'open' && String(a.args?.url).startsWith('spotify:')) { a.id = 'spotify.open'; delete a.args; }
      for (const s of a?.args?.steps ?? []) fix(s);
    };
    for (const c of saved.controls ?? []) {
      for (const v of c.variants ?? []) fix(v.action);
      for (const g of Object.values(c.gestures ?? {})) fix(g);
    }
    const old = saved.deck;
    const items: Item[] = old?.cells
      ? old.cells.flatMap((control: string, i: number) => control
        ? [{ id: `i${i}`, control, x: i % old.cols, y: Math.floor(i / old.cols), w: 1, h: 1 }] : [])
      : structuredClone(DEFAULT_PAGE.items);
    saved = { ...saved, version: 3, deck: old?.cells
      ? { rows: old.rows, cols: old.cols, size: old.size, gap: old.gap, items }
      : { ...structuredClone(DEFAULT_PAGE), items } };
  }
  if (saved.version !== 3 && saved.version !== 4 && saved.version !== 5) return out;

  // Preserve explicit colours and empty labels while canonicalizing every control once.
  for (const control of saved.controls ?? []) {
    for (const variant of control.variants ?? []) variant.color ??= control.color ?? '#8ea8f0';
  }
  saved.controls = (saved.controls ?? []).map((control: unknown) => normalizeControl(control));
  delete saved.slots; // the strip editor was removed; skins reuse the deck's controls

  const rawPages: unknown[] = saved.version === 5 && Array.isArray(saved.deck?.pages)
    ? saved.deck.pages
    : [{ ...structuredClone(DEFAULT_PAGE), ...(saved.deck ?? {}), id: 'page-1', name: 'Page 1' }];
  const pages: Page[] = [];
  const pageIds = new Set<string>(), itemIds = new Set<string>();
  for (const [index, raw] of rawPages.entries()) pages.push(normalizePage(raw, index, pageIds, itemIds));
  if (!pages.length) pages.push(structuredClone(DEFAULT_PAGE));

  // Placements used to share one control (and its state); give every extra placement its own copy.
  const seen = new Set<string>(), globalIds = new Set([...pageIds, ...itemIds, ...saved.controls.map((c: ControlConfig) => c.id)]);
  for (const page of pages) page.items = page.items.map(item => {
    if (!seen.has(item.control)) { seen.add(item.control); return item; }
    const source = saved.controls.find((c: ControlConfig) => c.id === item.control);
    if (!source) return item;
    let id = `${source.id}-2`, suffix = 3;
    while (globalIds.has(id)) id = `${source.id}-${suffix++}`;
    globalIds.add(id);
    saved.controls.push({ ...structuredClone(source), id });
    if (Object.hasOwn(saved.variants ?? {}, source.id)) saved.variants[id] = saved.variants[source.id];
    return { ...item, control: id };
  });

  const activePage = pages.some(page => page.id === saved.deck?.activePage) ? saved.deck.activePage : pages[0].id;
  const intervalSeconds = validInterval(saved.pageRotation?.intervalSeconds) ? saved.pageRotation.intervalSeconds : 0;
  return { ...out, ...saved, version: 5, display: { ...out.display, ...saved.display,
    alwaysOnTop: typeof saved.display?.alwaysOnTop === 'boolean' ? saved.display.alwaysOnTop : false,
    background: { ...out.display.background, ...saved.display?.background } },
    deck: { pages, activePage }, pageRotation: { intervalSeconds } };
}

/** Serialize the live settings with a stable launch placeholder, never the runtime page selection. */
export function serializeSettings(source: Settings = $state.snapshot(settings)) {
  const snapshot = structuredClone(source);
  snapshot.deck.activePage = snapshot.deck.pages[0]?.id ?? DEFAULT_PAGE.id;
  return JSON.stringify(snapshot);
}

export const settings: Settings = $state(structuredClone(DEFAULTS));
const remoteSettingsListeners = new Set<(next: Settings) => void>();

export function onRemoteSettings(listener: (next: Settings) => void) {
  remoteSettingsListeners.add(listener);
  return () => remoteSettingsListeners.delete(listener);
}

export async function loadSettings() {
  const browser = !isTauri();
  const browserKey = 'supadashboard:settings:v5';
  const legacyBrowserKey = 'supadashboard:settings:v4';
  let last = '';
  const assign = (next: Settings, activePage = next.deck.pages[0].id) => {
    next.deck.activePage = activePage;
    Object.assign(settings, next);
  };
  const applyInitial = (raw: unknown, rawJson?: string) => {
    if ((raw as any)?.version > 5) return false;
    const next = migrate(raw);
    assign(next);
    last = rawJson ?? '';
    return true;
  };
  const applyRemote = (raw: unknown) => {
    if ((raw as any)?.version > 5) return;
    const next = migrate(raw);
    const json = serializeSettings(next);
    if (json === last) return;
    for (const listener of remoteSettingsListeners) listener(next);
    assign(next, settings.deck.activePage);
    last = json;
  };

  if (browser) {
    const current = localStorage.getItem(browserKey);
    const rawJson = current ?? localStorage.getItem(legacyBrowserKey);
    let raw: unknown = null;
    if (rawJson) {
      try { raw = JSON.parse(rawJson); } catch { raw = null; }
    }
    if (!applyInitial(raw, rawJson ?? undefined)) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== browserKey || !event.newValue) return;
      try { applyRemote(JSON.parse(event.newValue)); } catch { /* unsupported or partial remote data is ignored */ }
    };
    window.addEventListener('storage', onStorage);
    $effect.root(() => {
      $effect(() => {
        const json = serializeSettings($state.snapshot(settings));
        if (json !== last) {
          last = json;
          localStorage.setItem(browserKey, json);
        }
      });
    });
    return;
  }
  const store = await load('settings.json', { defaults: {}, autoSave: 200 });
  const raw = await store.get('settings');
  if (!applyInitial(raw, raw ? JSON.stringify(raw) : undefined)) return;
  // Another window (dashboard <-> control panel) changed something: take it over.
  await store.onKeyChange('settings', value => {
    if (!value) return;
    try { applyRemote(value); } catch { /* unsupported or partial remote data is ignored */ }
  });
  $effect.root(() => {
    $effect(() => {
      const json = serializeSettings($state.snapshot(settings));
      if (json !== last) { last = json; void store.set('settings', JSON.parse(json)); }
    });
  });
}

export const controlById = (id: string) => settings.controls.find(c => c.id === id);

export const newId = (prefix: string, taken: string[]) => {
  const base = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  let id = base, n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
};

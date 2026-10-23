// User settings: one reactive object per window, persisted with tauri-plugin-store and kept in sync between
// the dashboard and the control panel (both windows load the same store and listen for its changes).
import { load } from '@tauri-apps/plugin-store';
import { isTauri } from '@tauri-apps/api/core';
import type { ControlConfig } from './controls';
import { normalizeControl } from './scenario';
import type { DeckSizing, Item } from './layout';

export type Deck = {
  rows: number;
  cols: number;
  /** Cell edge in px and spacing between cells. */
  size: number;
  sizing: DeckSizing;
  gap: number;
  items: Item[];
};

export type Settings = {
  version: 4;
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
  /** control id -> active variant (gesture swaps are sticky across restarts) */
  variants: Record<string, number>;
};

const swapVertical = { swipeDown: { variant: 'next' as const }, swipeUp: { variant: 'prev' as const } };
const media = (id: string, icon: string, name: string, color: string): ControlConfig => normalizeControl({
  id, name, type: 'button', gestures: swapVertical, variants: [
    { label: name, icon, color, action: { id: `media.${id}`, args: { source: 'system' } } },
    { label: name, icon, color: '#66ce8f', action: { id: `media.${id}`, args: { source: 'spotify' } } }],
});

export const DEFAULTS: Settings = {
  version: 4,
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
  deck: { rows: 3, cols: 6, size: 112, sizing: 'auto', gap: 14, items: [
    { id: 'i1', control: 'prev', x: 0, y: 0, w: 1, h: 1 },
    { id: 'i2', control: 'toggle', x: 1, y: 0, w: 1, h: 1 },
    { id: 'i3', control: 'next', x: 2, y: 0, w: 1, h: 1 },
    { id: 'i4', control: 'spotify', x: 3, y: 0, w: 1, h: 1 },
    { id: 'i5', control: 'mixer', x: 0, y: 1, w: 4, h: 2 },
    { id: 'i6', control: 'volume', x: 4, y: 0, w: 1, h: 3 },
  ] },
  variants: {},
};

/** Bring any saved settings up to the current version without losing the user's controls. */
export function migrate(saved: any): Settings {
  const out: Settings = structuredClone(DEFAULTS);
  if (!saved || typeof saved !== 'object') return out;
  saved = structuredClone(saved);
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
      : out.deck.items;
    saved = { ...saved, version: 3, deck: old?.cells ? { rows: old.rows, cols: old.cols, size: old.size, gap: old.gap, items } : out.deck };
  }
  if (typeof saved.version === 'number' && saved.version > 4)
    throw new Error(`Settings version ${saved.version} is newer than this app supports`);
  if (saved.version !== 3 && saved.version !== 4) return out;
  // Preserve explicit colours and empty labels while canonicalizing every control once.
  for (const control of saved.controls ?? []) {
    for (const variant of control.variants ?? []) variant.color ??= control.color ?? '#8ea8f0';
  }
  saved.controls = (saved.controls ?? []).map((control: unknown) => normalizeControl(control));
  saved.version = 4;
  delete saved.slots; // the strip editor was removed; skins reuse the deck's controls
  const deck = { ...out.deck, ...saved.deck };
  // Placements used to share one control (and its state); give every extra placement its own copy.
  const seen = new Set<string>();
  deck.items = (deck.items ?? []).map((item: Item) => {
    if (!seen.has(item.control)) { seen.add(item.control); return item; }
    const source = saved.controls.find((c: ControlConfig) => c.id === item.control);
    if (!source) return item;
    let id = `${source.id}-${2}`, n = 3;
    while (saved.controls.some((c: ControlConfig) => c.id === id)) id = `${source.id}-${n++}`;
    saved.controls.push({ ...structuredClone(source), id });
    return { ...item, control: id };
  });
  deck.sizing = saved.deck?.sizing === 'manual' ? 'manual' : 'auto';
  if (!Number.isFinite(deck.size) || deck.size <= 0) deck.size = DEFAULTS.deck.size;
  return { ...out, ...saved, display: { ...out.display, ...saved.display,
    alwaysOnTop: typeof saved.display?.alwaysOnTop === 'boolean' ? saved.display.alwaysOnTop : false,
    background: { ...out.display.background, ...saved.display?.background } },
    deck };
}

export const settings: Settings = $state(structuredClone(DEFAULTS));
const remoteSettingsListeners = new Set<(next: Settings) => void>();

export function onRemoteSettings(listener: (next: Settings) => void) {
  remoteSettingsListeners.add(listener);
  return () => remoteSettingsListeners.delete(listener);
}

export async function loadSettings() {
  const browser = !isTauri();
  const browserKey = 'supadashboard:settings:v4';
  let last = '';
  const apply = (raw: unknown) => {
    const next = migrate(raw);
    last = JSON.stringify(next);
    Object.assign(settings, next);
  };
  if (browser) {
    const applyRemote = (raw: unknown) => {
      const next = migrate(raw);
      if (JSON.stringify(next) === last) return;
      for (const listener of remoteSettingsListeners) listener(next);
      apply(next);
    };
    try { apply(JSON.parse(localStorage.getItem(browserKey) ?? 'null')); } catch { apply(null); }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== browserKey || !event.newValue) return;
      try { applyRemote(JSON.parse(event.newValue)); } catch { /* another tab's partial write is ignored */ }
    };
    window.addEventListener('storage', onStorage);
    $effect.root(() => {
      $effect(() => {
        const snap = $state.snapshot(settings);
        const json = JSON.stringify(snap);
        if (json !== last) {
          last = json;
          localStorage.setItem(browserKey, json);
        }
      });
    });
    return;
  }
  const store = await load('settings.json', { defaults: {}, autoSave: 200 });
  apply(await store.get('settings'));
  // Another window (dashboard <-> control panel) changed something: take it over.
  await store.onKeyChange('settings', raw => {
    if (!raw) return;
    const next = migrate(raw);
    if (JSON.stringify(next) !== last) {
      for (const listener of remoteSettingsListeners) listener(next);
      apply(next);
    }
  });
  $effect.root(() => {
    $effect(() => {
      const snap = $state.snapshot(settings);
      const json = JSON.stringify(snap);
      if (json !== last) { last = json; void store.set('settings', snap); }
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

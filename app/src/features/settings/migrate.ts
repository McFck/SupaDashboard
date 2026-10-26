// Upgrades any supported saved settings to the current version and normalizes them.
import type { ControlConfig } from '../controls/model';
import type { Item } from '../layout/grid';
import { normalizeControl } from '../automation/scenario';
import { DEFAULT_PAGE, DEFAULTS, type Page, type Settings } from './schema';

function uniqueId(value: unknown, used: Set<string>, base: string) {
  if (typeof value === 'string' && value.trim() && !used.has(value)) {
    used.add(value);
    return value;
  }
  let index = 1,
    id = `${base}-${index}`;
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
  const items = Array.isArray(source.items)
    ? source.items.flatMap((item: any) => {
        if (
          !item ||
          typeof item !== 'object' ||
          typeof item.control !== 'string' ||
          !item.control ||
          ![item.x, item.y, item.w, item.h].every(Number.isSafeInteger) ||
          item.x < 0 ||
          item.y < 0 ||
          item.w <= 0 ||
          item.h <= 0
        )
          return [];
        return [{ ...item, id: uniqueId(item.id, itemIds, 'item') } as Item];
      })
    : [];
  const name =
    typeof source.name === 'string' && source.name.trim()
      ? source.name.trim()
      : `Page ${index + 1}`;
  return {
    id,
    name,
    rows,
    cols,
    size,
    gap,
    sizing: source.sizing === 'manual' ? 'manual' : 'auto',
    items,
  };
}

function normalizeSkinLayouts(raw: unknown, itemIds: Set<string>) {
  const layouts: Settings['skinLayouts'] = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return layouts;
  for (const [skinId, rawPages] of Object.entries(raw)) {
    if (
      !skinId ||
      skinId === 'deck' ||
      !rawPages ||
      typeof rawPages !== 'object' ||
      Array.isArray(rawPages)
    )
      continue;
    const pages: Record<string, Record<string, Item[]>> = {};
    for (const [pageId, rawSlots] of Object.entries(rawPages)) {
      if (!pageId || !rawSlots || typeof rawSlots !== 'object' || Array.isArray(rawSlots)) continue;
      const slots: Record<string, Item[]> = {};
      for (const [slotId, rawItems] of Object.entries(rawSlots)) {
        if (!slotId || !Array.isArray(rawItems)) continue;
        slots[slotId] = rawItems.flatMap((item: any) => {
          if (
            !item ||
            typeof item !== 'object' ||
            typeof item.control !== 'string' ||
            !item.control ||
            ![item.x, item.y, item.w, item.h].every(Number.isSafeInteger) ||
            item.x < 0 ||
            item.y < 0 ||
            item.w <= 0 ||
            item.h <= 0
          )
            return [];
          return [{ ...item, id: uniqueId(item.id, itemIds, 'item') } as Item];
        });
      }
      pages[pageId] = slots;
    }
    layouts[skinId] = pages;
  }
  return layouts;
}

/** Bring any saved settings up to the current version without losing the user's controls. */
export function migrate(input: any): Settings {
  const out = structuredClone(DEFAULTS);
  if (!input || typeof input !== 'object') return out;
  let saved = structuredClone(input);
  if (typeof saved.version === 'number' && saved.version > 6)
    throw new Error(`Settings version ${saved.version} is newer than this app supports`);
  if (saved.version === 1) {
    const icon: Record<string, string> = {
      prev: 'SkipBack',
      next: 'SkipForward',
      playpause: 'Play',
      volume: 'Volume2',
    };
    for (const c of saved.controls ?? []) {
      c.name ??= c.id;
      for (const v of c.variants ?? []) v.icon = icon[v.icon] ?? v.icon;
    }
    saved = {
      ...saved,
      version: 2,
      skin: saved.skin === 'classic' ? 'deck' : saved.skin,
      deck: null,
    };
  }
  if (saved.version === 2) {
    // Media targets became plugin-provided sources; Spotify's app link became the Spotify plugin's action.
    const fix = (a: any) => {
      if (a?.id?.startsWith('media.'))
        a.args = { source: a.args?.target === 'spotify' ? 'spotify' : 'system' };
      if (a?.id === 'open' && String(a.args?.url).startsWith('spotify:')) {
        a.id = 'spotify.open';
        delete a.args;
      }
      for (const s of a?.args?.steps ?? []) fix(s);
    };
    for (const c of saved.controls ?? []) {
      for (const v of c.variants ?? []) fix(v.action);
      for (const g of Object.values(c.gestures ?? {})) fix(g);
    }
    const old = saved.deck;
    const items: Item[] = old?.cells
      ? old.cells.flatMap((control: string, i: number) =>
          control
            ? [{ id: `i${i}`, control, x: i % old.cols, y: Math.floor(i / old.cols), w: 1, h: 1 }]
            : [],
        )
      : structuredClone(DEFAULT_PAGE.items);
    saved = {
      ...saved,
      version: 3,
      deck: old?.cells
        ? { rows: old.rows, cols: old.cols, size: old.size, gap: old.gap, items }
        : { ...structuredClone(DEFAULT_PAGE), items },
    };
  }
  // v6 was briefly emitted by a development build with this same settings shape; normalize it back to v5.
  if (saved.version !== 3 && saved.version !== 4 && saved.version !== 5 && saved.version !== 6)
    throw new Error(`Unsupported settings version ${saved.version}`); // never let an unknown file fall back to defaults and get saved over

  // Preserve explicit colours and empty labels while canonicalizing every control once.
  for (const control of saved.controls ?? []) {
    for (const variant of control.variants ?? []) variant.color ??= control.color ?? '#8ea8f0';
  }
  saved.controls = (saved.controls ?? []).map((control: unknown) => normalizeControl(control));
  delete saved.slots; // the strip editor was removed; skins reuse the deck's controls

  const rawPages: unknown[] =
    saved.version >= 5 && Array.isArray(saved.deck?.pages)
      ? saved.deck.pages
      : [{ ...structuredClone(DEFAULT_PAGE), ...(saved.deck ?? {}), id: 'page-1', name: 'Page 1' }];
  const pages: Page[] = [];
  const pageIds = new Set<string>(),
    itemIds = new Set<string>();
  for (const [index, raw] of rawPages.entries())
    pages.push(normalizePage(raw, index, pageIds, itemIds));
  if (!pages.length) pages.push(structuredClone(DEFAULT_PAGE));

  // Item IDs share one namespace with page IDs and every skin placement.
  itemIds.clear();
  for (const id of pageIds) itemIds.add(id);
  for (const page of pages)
    for (const item of page.items) item.id = uniqueId(item.id, itemIds, 'item');
  const skinLayouts = normalizeSkinLayouts(saved.skinLayouts, itemIds);
  const skinSettings =
    saved.skinSettings &&
    typeof saved.skinSettings === 'object' &&
    !Array.isArray(saved.skinSettings)
      ? Object.fromEntries(
          Object.entries(saved.skinSettings)
            .filter(
              ([id, value]) => id && !!value && typeof value === 'object' && !Array.isArray(value),
            )
            .map(([id, value]) => [id, structuredClone(value)]),
        )
      : {};

  // Placements used to share one control (and its state); give every extra placement its own copy.
  const seen = new Set<string>(),
    globalIds = new Set([
      ...pageIds,
      ...itemIds,
      ...saved.controls.map((c: ControlConfig) => c.id),
    ]);
  const placementLists = [
    ...pages.map((page) => page.items),
    ...Object.values(skinLayouts).flatMap((skin) =>
      Object.values(skin).flatMap((page) => Object.values(page)),
    ),
  ];
  for (const items of placementLists)
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!seen.has(item.control)) {
        seen.add(item.control);
        continue;
      }
      const source = saved.controls.find((c: ControlConfig) => c.id === item.control);
      if (!source) continue;
      let id = `${source.id}-2`,
        suffix = 3;
      while (globalIds.has(id)) id = `${source.id}-${suffix++}`;
      globalIds.add(id);
      saved.controls.push({ ...structuredClone(source), id });
      saved.variants ??= {};
      if (Object.hasOwn(saved.variants, source.id)) saved.variants[id] = saved.variants[source.id];
      items[index] = { ...item, control: id };
    }

  const activePage = pages.some((page) => page.id === saved.deck?.activePage)
    ? saved.deck.activePage
    : pages[0].id;
  delete saved.pageRotation;
  return {
    ...out,
    ...saved,
    version: 5,
    display: {
      ...out.display,
      ...saved.display,
      alwaysOnTop:
        typeof saved.display?.alwaysOnTop === 'boolean' ? saved.display.alwaysOnTop : false,
      background: { ...out.display.background, ...saved.display?.background },
    },
    deck: { pages, activePage },
    skinSettings,
    skinLayouts,
    variants: {
      ...out.variants,
      ...(saved.variants && typeof saved.variants === 'object' ? saved.variants : {}),
    },
  };
}

// Upgrades any supported saved settings to the current version and normalizes them.
import type { ControlConfig } from '../controls/model';
import type { Item } from '../layout/grid';
import { normalizeControl } from '../automation/normalize-control';
import { DEFAULT_PAGE, DEFAULTS, type Page, type Settings } from './schema';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error('Settings contain a malformed object');
  }
  return value;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function normalizeItems(raw: unknown, itemIds: Set<string>): Item[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item: unknown) => {
    if (
      !isRecord(item) ||
      typeof item.control !== 'string' ||
      !item.control ||
      typeof item.x !== 'number' ||
      !Number.isSafeInteger(item.x) ||
      item.x < 0 ||
      typeof item.y !== 'number' ||
      !Number.isSafeInteger(item.y) ||
      item.y < 0 ||
      !positiveInteger(item.w) ||
      !positiveInteger(item.h)
    ) {
      return [];
    }
    return [
      {
        ...item,
        id: uniqueId(item.id, itemIds, 'item'),
        control: item.control,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      },
    ];
  });
}

function savedControls(raw: unknown): (Record<string, unknown> & {
  id: string;
  name: string;
  type: string;
  variants: Record<string, unknown>[];
  gestures: Record<string, unknown>;
})[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error('Settings controls must be an array');
  }
  return raw.map((value: unknown) => {
    const control = object(value);
    if (typeof control.id !== 'string' || !control.id || typeof control.type !== 'string') {
      throw new Error('Settings contain a malformed control');
    }
    if (control.name !== undefined && typeof control.name !== 'string') {
      throw new Error('Control name must be text');
    }
    if (control.variants !== undefined && !Array.isArray(control.variants)) {
      throw new Error('Control variants must be an array');
    }
    if (control.options !== undefined) {
      object(control.options);
    }
    if (control.stateBinding !== undefined && control.stateBinding !== null) {
      const binding = object(control.stateBinding);
      if (
        typeof binding.variableId !== 'string' ||
        !Array.isArray(binding.cases) ||
        !binding.cases.every(
          (entry: unknown) =>
            isRecord(entry) &&
            typeof entry.stateId === 'string' &&
            (typeof entry.value === 'string' ||
              typeof entry.value === 'boolean' ||
              (typeof entry.value === 'number' && Number.isFinite(entry.value))),
        )
      ) {
        throw new Error('Settings contain a malformed state binding');
      }
    }
    const variants: Record<string, unknown>[] = (control.variants ?? []).map((variant: unknown) => {
      if (
        !isRecord(variant) ||
        (variant.label !== undefined && typeof variant.label !== 'string')
      ) {
        throw new Error('Settings contain a malformed variant');
      }
      for (const field of ['icon', 'color', 'background']) {
        if (variant[field] != null && typeof variant[field] !== 'string') {
          throw new Error(`Variant ${field} must be text`);
        }
      }
      return { ...variant, label: variant.label ?? '' };
    });
    return {
      ...control,
      id: control.id,
      name: control.name ?? control.id,
      type: control.type,
      variants,
      gestures: object(control.gestures),
    };
  });
}

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

function normalizePage(
  raw: unknown,
  index: number,
  pageIds: Set<string>,
  itemIds: Set<string>,
): Page {
  const source = object(raw);
  const fallback = DEFAULT_PAGE;
  const id = uniqueId(source.id, pageIds, 'page');
  const rows = positiveInteger(source.rows) ? source.rows : fallback.rows;
  const cols = positiveInteger(source.cols) ? source.cols : fallback.cols;
  const size =
    typeof source.size === 'number' && Number.isFinite(source.size) && source.size > 0
      ? source.size
      : fallback.size;
  const gap =
    typeof source.gap === 'number' && Number.isFinite(source.gap) && source.gap >= 0
      ? source.gap
      : fallback.gap;
  const items = normalizeItems(source.items, itemIds);
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
        slots[slotId] = normalizeItems(rawItems, itemIds);
      }
      pages[pageId] = slots;
    }
    layouts[skinId] = pages;
  }
  return layouts;
}

/** Bring any saved settings up to the current version without losing the user's controls. */
export function migrate(input: unknown): Settings {
  const out = structuredClone(DEFAULTS);
  if (input === undefined || input === null) {
    return out;
  }
  if (!isRecord(input)) {
    throw new Error('Settings must be an object');
  }
  let saved = structuredClone(input);
  if (typeof saved.version === 'number' && saved.version > 6)
    throw new Error(`Settings version ${saved.version} is newer than this app supports`);
  const rawControls = savedControls(saved.controls);
  if (saved.version === 1) {
    const icon: Record<string, string> = {
      prev: 'SkipBack',
      next: 'SkipForward',
      playpause: 'Play',
      volume: 'Volume2',
    };
    for (const c of rawControls) {
      for (const v of c.variants) {
        if (typeof v.icon === 'string') {
          v.icon = icon[v.icon] ?? v.icon;
        }
      }
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
    const fix = (value: unknown) => {
      if (value === undefined || value === null) {
        return;
      }
      const a = object(value);
      const args = object(a.args);
      if (typeof a.id === 'string' && a.id.startsWith('media.')) {
        a.args = { source: args.target === 'spotify' ? 'spotify' : 'system' };
      }
      if (a.id === 'open' && typeof args.url === 'string' && args.url.startsWith('spotify:')) {
        a.id = 'spotify.open';
        delete a.args;
      }
      if (args.steps !== undefined && !Array.isArray(args.steps)) {
        throw new Error('Sequence steps must be an array');
      }
      for (const s of args.steps ?? []) {
        fix(s);
      }
    };
    for (const c of rawControls) {
      for (const v of c.variants) {
        fix(v.action);
      }
      for (const g of Object.values(c.gestures)) {
        fix(g);
      }
    }
    const old = object(saved.deck);
    if (
      old.cells !== undefined &&
      (!Array.isArray(old.cells) ||
        !old.cells.every((cell: unknown) => typeof cell === 'string' || cell === null))
    ) {
      throw new Error('Legacy deck cells must be an array of control IDs');
    }
    const cols = positiveInteger(old.cols) ? old.cols : DEFAULT_PAGE.cols;
    const items: Item[] = Array.isArray(old.cells)
      ? old.cells.flatMap((control: string | null, i: number) =>
          control
            ? [{ id: `i${i}`, control, x: i % cols, y: Math.floor(i / cols), w: 1, h: 1 }]
            : [],
        )
      : structuredClone(DEFAULT_PAGE.items);
    saved = {
      ...saved,
      version: 3,
      deck: Array.isArray(old.cells)
        ? { rows: old.rows, cols: old.cols, size: old.size, gap: old.gap, items }
        : { ...structuredClone(DEFAULT_PAGE), items },
    };
  }
  // v6 was briefly emitted by a development build with this same settings shape; normalize it back to v5.
  if (saved.version !== 3 && saved.version !== 4 && saved.version !== 5 && saved.version !== 6)
    throw new Error(`Unsupported settings version ${saved.version}`); // never let an unknown file fall back to defaults and get saved over

  // Preserve explicit colours and empty labels while canonicalizing every control once.
  for (const control of rawControls) {
    for (const variant of control.variants) {
      variant.color ??= control.color ?? '#8ea8f0';
    }
  }
  const controls = rawControls.map((control) => normalizeControl(control));
  delete saved.slots; // the strip editor was removed; skins reuse the deck's controls

  const deck = object(saved.deck);
  if (deck.pages !== undefined && !Array.isArray(deck.pages)) {
    throw new Error('Deck pages must be an array');
  }
  const rawPages: unknown[] =
    (saved.version === 5 || saved.version === 6) && Array.isArray(deck.pages)
      ? deck.pages
      : [{ ...structuredClone(DEFAULT_PAGE), ...deck, id: 'page-1', name: 'Page 1' }];
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
              (entry): entry is [string, Record<string, unknown>] =>
                !!entry[0] && isRecord(entry[1]),
            )
            .map(([id, value]) => [id, structuredClone(value)]),
        )
      : {};

  // Placements used to share one control (and its state); give every extra placement its own copy.
  const variants: Settings['variants'] = {};
  for (const [id, index] of Object.entries(object(saved.variants))) {
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
      throw new Error('Saved control state must be a nonnegative integer');
    }
    variants[id] = index;
  }
  const seen = new Set<string>(),
    globalIds = new Set([...pageIds, ...itemIds, ...controls.map((c: ControlConfig) => c.id)]);
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
      const source = controls.find((c: ControlConfig) => c.id === item.control);
      if (!source) continue;
      let id = `${source.id}-2`,
        suffix = 3;
      while (globalIds.has(id)) id = `${source.id}-${suffix++}`;
      globalIds.add(id);
      controls.push({ ...structuredClone(source), id });
      if (Object.hasOwn(variants, source.id)) {
        variants[id] = variants[source.id];
      }
      items[index] = { ...item, control: id };
    }

  const activePage = pages.find((page) => page.id === deck.activePage)?.id ?? pages[0].id;
  const display = object(saved.display);
  const background = object(display.background);
  delete saved.pageRotation;
  return {
    ...out,
    ...saved,
    version: 5,
    skin: typeof saved.skin === 'string' ? saved.skin : out.skin,
    controls,
    display: {
      ...out.display,
      ...display,
      monitor: typeof display.monitor === 'string' ? display.monitor : null,
      fullscreen: typeof display.fullscreen === 'boolean' ? display.fullscreen : false,
      alwaysOnTop: typeof display.alwaysOnTop === 'boolean' ? display.alwaysOnTop : false,
      background: {
        ...out.display.background,
        ...background,
        color:
          typeof background.color === 'string' ? background.color : out.display.background.color,
        opacity:
          typeof background.opacity === 'number' && Number.isFinite(background.opacity)
            ? background.opacity
            : out.display.background.opacity,
        radius:
          typeof background.radius === 'number' && Number.isFinite(background.radius)
            ? background.radius
            : out.display.background.radius,
      },
    },
    deck: { pages, activePage },
    skinSettings,
    skinLayouts,
    variants,
  };
}

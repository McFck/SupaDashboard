import type { Item } from '../layout/grid';
import type { AppletSettingsEntry, Page, Settings } from './schema';
import { DEFAULT_PAGE } from './defaults';
import { isRecord } from '../automation/plain-data';
import { isAppKey } from '../apps/keys';
import { object, positiveInteger } from './upgrade';

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

function uniqueId(value: unknown, used: Set<string>, base: string) {
  if (typeof value === 'string' && value.trim() && !used.has(value)) {
    used.add(value);
    return value;
  }
  let index = 1,
    id = `${base}-${index}`;
  while (used.has(id)) {
    id = `${base}-${++index}`;
  }
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
  let apps: string[] | undefined;
  if (source.apps !== undefined) {
    if (!Array.isArray(source.apps) || !source.apps.every(isAppKey)) {
      throw new Error('Page apps must be a list of app keys');
    }
    const unique = [...new Set(source.apps)];
    if (unique.length) {
      apps = unique;
    }
  }
  return {
    id,
    name,
    rows,
    cols,
    size,
    gap,
    sizing: source.sizing === 'manual' ? 'manual' : 'auto',
    items,
    ...(typeof source.applet === 'string' && source.applet.length <= 128 && source.applet
      ? { applet: source.applet }
      : {}),
    ...(source.hidden === true ? { hidden: true } : {}),
    ...(apps ? { apps } : {}),
  };
}

function normalizeAppletLayouts(raw: unknown, itemIds: Set<string>) {
  const layouts: Settings['appletLayouts'] = {};
  if (!isRecord(raw)) {
    return layouts;
  }
  for (const [appletId, rawPages] of Object.entries(raw)) {
    if (!appletId || appletId === 'deck' || !isRecord(rawPages)) {
      continue;
    }
    const pages: Record<string, Record<string, Item[]>> = {};
    for (const [pageId, rawSlots] of Object.entries(rawPages)) {
      if (!pageId || !isRecord(rawSlots)) {
        continue;
      }
      const slots: Record<string, Item[]> = {};
      for (const [slotId, rawItems] of Object.entries(rawSlots)) {
        if (!slotId || !Array.isArray(rawItems)) {
          continue;
        }
        slots[slotId] = normalizeItems(rawItems, itemIds);
      }
      pages[pageId] = slots;
    }
    layouts[appletId] = pages;
  }
  return layouts;
}

const records = (raw: unknown) =>
  Object.fromEntries(
    Object.entries(isRecord(raw) ? raw : {})
      .filter(([key, value]) => !!key && isRecord(value))
      .map(([key, value]) => [key, structuredClone(value as Record<string, unknown>)]),
  );

export function normalizeAppletSettings(raw: unknown) {
  const entries: Record<string, AppletSettingsEntry> = {};
  for (const [id, value] of Object.entries(records(raw))) {
    if (!isRecord(value.shared)) {
      continue;
    }
    const perPage = records(value.perPage);
    entries[id] = {
      shared: value.shared,
      separate: value.separate === true,
      ...(Object.keys(perPage).length ? { perPage } : {}),
    };
  }
  return entries;
}

export function normalizeLayout(saved: Record<string, unknown>) {
  const deck = object(saved.deck);
  if (deck.pages !== undefined && !Array.isArray(deck.pages)) {
    throw new Error('Deck pages must be an array');
  }
  const rawPages: unknown[] = Array.isArray(deck.pages)
    ? deck.pages
    : [{ ...structuredClone(DEFAULT_PAGE), ...deck, id: 'page-1', name: 'Page 1' }];
  const pages: Page[] = [];
  const pageIds = new Set<string>(),
    itemIds = new Set<string>();
  for (const [index, raw] of rawPages.entries()) {
    pages.push(normalizePage(raw, index, pageIds, itemIds));
  }
  if (!pages.length) {
    pages.push(structuredClone(DEFAULT_PAGE));
  }

  // Item IDs share one namespace with page IDs and every applet placement.
  itemIds.clear();
  for (const id of pageIds) {
    itemIds.add(id);
  }
  for (const page of pages) {
    for (const item of page.items) {
      item.id = uniqueId(item.id, itemIds, 'item');
    }
  }
  const appletLayouts = normalizeAppletLayouts(saved.appletLayouts, itemIds);
  const activePage = pages.find((page) => page.id === deck.activePage)?.id ?? pages[0].id;
  return { deck: { pages, activePage }, appletLayouts, pageIds, itemIds };
}

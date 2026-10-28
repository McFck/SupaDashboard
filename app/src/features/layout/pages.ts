import type { Item } from './grid';
import type { ControlConfig } from '../controls/model';
import type { Page, Settings } from '../settings/schema';
import { pageItems } from './placements';

export const MAX_PAGES = 10;
export type PageChange = { pages: Page[] };
export type PageDeckChange = PageChange & {
  controls: ControlConfig[];
  variants: Settings['variants'];
  skinLayouts: Settings['skinLayouts'];
};
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function nextPageName(pages: readonly Page[]) {
  const used = new Set(pages.map((page) => page.name));
  for (let n = 1; ; n++) if (!used.has(`Page ${n}`)) return `Page ${n}`;
}

function newGlobalId(prefix: string, used: Set<string>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const id = `${prefix}-${crypto.randomUUID()}`;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
  return undefined;
}

type SkinLayouts = Settings['skinLayouts'];

function allIds(
  pages: readonly Page[],
  controls: readonly ControlConfig[],
  layouts: SkinLayouts = {},
) {
  return new Set([
    ...pages.map((page) => page.id),
    ...pageItems(pages, layouts).map((item) => item.id),
    ...controls.map((control) => control.id),
  ]);
}

export function addPage(
  pages: readonly Page[],
  controls: readonly ControlConfig[],
  sourcePageId?: string,
  skinLayouts: SkinLayouts = {},
) {
  if (pages.length >= MAX_PAGES) return undefined;
  const source = pageById(pages, sourcePageId);
  if (!source) return undefined;
  const id = newGlobalId('page', allIds(pages, controls, skinLayouts));
  if (!id) return undefined;
  const page: Page = {
    id,
    name: nextPageName(pages),
    rows: source.rows,
    cols: source.cols,
    size: source.size,
    sizing: source.sizing,
    gap: source.gap,
    items: [],
  };
  return { pages: [...pages, page], page };
}

export function renamePage(
  pages: readonly Page[],
  pageId: string,
  name: string,
): PageChange | undefined {
  const target = pages.find((page) => page.id === pageId),
    trimmed = name.trim();
  if (!target || !trimmed || target.name === trimmed) return undefined;
  return { pages: pages.map((page) => (page.id === pageId ? { ...page, name: trimmed } : page)) };
}

export function duplicatePage(
  pages: readonly Page[],
  pageId: string,
  controls: readonly ControlConfig[],
  variants: Settings['variants'],
  skinLayouts: SkinLayouts = {},
) {
  if (pages.length >= MAX_PAGES) return undefined;
  const source = pages.find((page) => page.id === pageId);
  if (!source) return undefined;
  const sourceControls = new Map(controls.map((control) => [control.id, control]));
  if (source.items.some((item) => !sourceControls.has(item.control))) return undefined;
  const ids = allIds(pages, controls, skinLayouts);
  const id = newGlobalId('page', ids);
  if (!id) return undefined;
  const copiedControls: ControlConfig[] = [];
  const copiedItems: Item[] = [];
  const copyItems = (items: readonly Item[]) => {
    const copied: Item[] = [];
    for (const item of items) {
      const control = sourceControls.get(item.control);
      if (!control) return undefined;
      const controlId = newGlobalId(control.id, ids),
        itemId = newGlobalId('item', ids);
      if (!controlId || !itemId) return undefined;
      copiedControls.push({ ...cloneJson(control), id: controlId });
      copied.push({ ...item, id: itemId, control: controlId });
    }
    return copied;
  };
  const deckItems = copyItems(source.items);
  if (!deckItems) return undefined;
  copiedItems.push(...deckItems);
  const nextSkinLayouts = cloneJson(skinLayouts);
  delete nextSkinLayouts.deck;
  for (const [skinId, byPage] of Object.entries(skinLayouts)) {
    if (skinId === 'deck') continue;
    const sourceSlots = byPage[pageId];
    if (!sourceSlots) continue;
    const copiedSlots: Record<string, Item[]> = {};
    for (const [slotId, items] of Object.entries(sourceSlots)) {
      const copies = copyItems(items);
      if (!copies) return undefined;
      copiedSlots[slotId] = copies;
    }
    nextSkinLayouts[skinId][id] = copiedSlots;
  }
  const page: Page = { ...cloneJson(source), id, name: `${source.name} copy`, items: copiedItems };
  return {
    pages: [...pages, page],
    page,
    controls: [...controls, ...copiedControls],
    variants: { ...variants },
    skinLayouts: nextSkinLayouts,
  };
}

export function reorderPage(
  pages: readonly Page[],
  pageId: string,
  to: number,
): PageChange | undefined {
  const from = pages.findIndex((page) => page.id === pageId);
  if (from < 0 || !Number.isInteger(to) || to < 0 || to >= pages.length || from === to)
    return undefined;
  const next = [...pages],
    [page] = next.splice(from, 1);
  next.splice(to, 0, page);
  return { pages: next };
}

export function deletePage(
  pages: readonly Page[],
  pageId: string,
  controls: readonly ControlConfig[],
  variants: Settings['variants'],
  skinLayouts: SkinLayouts = {},
) {
  if (pages.length <= 1 || !pages.some((page) => page.id === pageId)) return undefined;
  const next = pages.filter((page) => page.id !== pageId);
  const nextSkinLayouts = cloneJson(skinLayouts);
  delete nextSkinLayouts.deck;
  for (const byPage of Object.values(nextSkinLayouts)) delete byPage[pageId];
  const usedControls = new Set(pageItems(next, nextSkinLayouts).map((item) => item.control));
  const removedControls = new Set(
    controls.filter((control) => !usedControls.has(control.id)).map((control) => control.id),
  );
  const nextVariants = { ...variants };
  for (const id of removedControls) delete nextVariants[id];
  return {
    pages: next,
    controls: controls.filter((control) => !removedControls.has(control.id)),
    variants: nextVariants,
    skinLayouts: nextSkinLayouts,
  };
}

export function pageById(pages: readonly Page[], id: string | undefined) {
  return pages.find((page) => page.id === id) ?? pages[0];
}

export function pageAfterRemoval(
  pages: readonly Page[],
  removedId: string,
  previousOrder: readonly string[],
) {
  if (pages.some((page) => page.id === removedId)) return removedId;
  if (!pages.length) return undefined;
  const oldIndex = previousOrder.indexOf(removedId);
  return pages[Math.min(Math.max(0, oldIndex), pages.length - 1)].id;
}

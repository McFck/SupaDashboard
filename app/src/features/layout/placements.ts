// Stored placements as saved: deck pages plus every skin's page/slot map, with no registry lookups. Unknown skins
// and slots are listed too, so their retained data still counts as a use of its control.
import type { Item } from './grid';
import type { Page, Settings } from '../settings/schema';
import type { LayoutTarget } from './skin-layouts';

type SkinLayouts = Settings['skinLayouts'];
type PlacementSource = { deck: { pages: readonly Page[] }; skinLayouts?: SkinLayouts };
export type StoredPlacement = LayoutTarget & { item: Item };

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Deck pages first, then skin slots. A stale `skinLayouts.deck` alias is ignored: deck placements live on pages. */
export function storedPlacements(source: PlacementSource): StoredPlacement[] {
  const placements: StoredPlacement[] = [];
  for (const page of source.deck.pages) {
    for (const item of page.items) {
      placements.push({ skinId: 'deck', pageId: page.id, slotId: 'main', item });
    }
  }
  for (const [skinId, pages] of Object.entries(source.skinLayouts ?? {})) {
    if (skinId === 'deck') {
      continue;
    }
    for (const [pageId, slots] of Object.entries(pages)) {
      for (const [slotId, items] of Object.entries(slots)) {
        for (const item of items) {
          placements.push({ skinId, pageId, slotId, item });
        }
      }
    }
  }
  return placements;
}

export function pageItems(pages: readonly Page[], layouts: SkinLayouts = {}): Item[] {
  return storedPlacements({ deck: { pages }, skinLayouts: layouts }).map(
    (placement) => placement.item,
  );
}

export function hasPlacement(source: PlacementSource, controlId: string) {
  return storedPlacements(source).some((placement) => placement.item.control === controlId);
}

/** Removes one placement; `orphanControl` names its control when no other placement uses it. */
export function removePlacement(
  pages: readonly Page[],
  pageId: string,
  itemId: string,
  layouts: SkinLayouts = {},
) {
  const target = pages.find((page) => page.id === pageId);
  const item = target?.items.find((candidate) => candidate.id === itemId);
  if (target && item) {
    const next = pages.map((page) =>
      page.id === pageId
        ? { ...page, items: page.items.filter((candidate) => candidate.id !== itemId) }
        : page,
    );
    const nextLayouts = { ...layouts };
    delete nextLayouts.deck;
    return {
      pages: next,
      skinLayouts: nextLayouts,
      item,
      orphanControl: orphan(next, nextLayouts, item.control),
    };
  }
  for (const [skinId, byPage] of Object.entries(layouts)) {
    const slots = skinId === 'deck' ? undefined : byPage[pageId];
    const slotId =
      slots && Object.keys(slots).find((id) => slots[id].some((entry) => entry.id === itemId));
    if (!slots || !slotId) {
      continue;
    }
    const found = slots[slotId].find((candidate) => candidate.id === itemId)!;
    const nextLayouts = cloneJson(layouts);
    delete nextLayouts.deck;
    nextLayouts[skinId][pageId][slotId] = slots[slotId].filter(
      (candidate) => candidate.id !== itemId,
    );
    return {
      pages: pages as Page[],
      skinLayouts: nextLayouts,
      item: found,
      orphanControl: orphan(pages, nextLayouts, found.control),
    };
  }
  return {
    pages: pages as Page[],
    skinLayouts: layouts,
    item: undefined,
    orphanControl: undefined,
  };
}

function orphan(pages: readonly Page[], skinLayouts: SkinLayouts, controlId: string) {
  return hasPlacement({ deck: { pages }, skinLayouts }, controlId) ? undefined : controlId;
}

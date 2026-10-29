// Stored placements as saved: deck pages plus every applet's page/slot map, with no registry lookups. Unknown applets
// and slots are listed too, so their retained data still counts as a use of its control.
import type { Item } from './grid';
import type { Page, Settings } from '../settings/schema';
import type { LayoutTarget } from './applet-layouts';

type AppletLayouts = Settings['appletLayouts'];
type PlacementSource = { deck: { pages: readonly Page[] }; appletLayouts?: AppletLayouts };
export type StoredPlacement = LayoutTarget & { item: Item };

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Deck pages first, then applet slots. A stale `appletLayouts.deck` alias is ignored: deck placements live on pages. */
export function storedPlacements(source: PlacementSource): StoredPlacement[] {
  const placements: StoredPlacement[] = [];
  for (const page of source.deck.pages) {
    for (const item of page.items) {
      placements.push({ appletId: 'deck', pageId: page.id, slotId: 'main', item });
    }
  }
  for (const [appletId, pages] of Object.entries(source.appletLayouts ?? {})) {
    if (appletId === 'deck') {
      continue;
    }
    for (const [pageId, slots] of Object.entries(pages)) {
      for (const [slotId, items] of Object.entries(slots)) {
        for (const item of items) {
          placements.push({ appletId, pageId, slotId, item });
        }
      }
    }
  }
  return placements;
}

export function pageItems(pages: readonly Page[], layouts: AppletLayouts = {}): Item[] {
  return storedPlacements({ deck: { pages }, appletLayouts: layouts }).map(
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
  layouts: AppletLayouts = {},
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
      appletLayouts: nextLayouts,
      item,
      orphanControl: orphan(next, nextLayouts, item.control),
    };
  }
  for (const [appletId, byPage] of Object.entries(layouts)) {
    const slots = appletId === 'deck' ? undefined : byPage[pageId];
    const slotId =
      slots && Object.keys(slots).find((id) => slots[id].some((entry) => entry.id === itemId));
    if (!slots || !slotId) {
      continue;
    }
    const found = slots[slotId].find((candidate) => candidate.id === itemId)!;
    const nextLayouts = cloneJson(layouts);
    delete nextLayouts.deck;
    nextLayouts[appletId][pageId][slotId] = slots[slotId].filter(
      (candidate) => candidate.id !== itemId,
    );
    return {
      pages: pages as Page[],
      appletLayouts: nextLayouts,
      item: found,
      orphanControl: orphan(pages, nextLayouts, found.control),
    };
  }
  return {
    pages: pages as Page[],
    appletLayouts: layouts,
    item: undefined,
    orphanControl: undefined,
  };
}

function orphan(pages: readonly Page[], appletLayouts: AppletLayouts, controlId: string) {
  return hasPlacement({ deck: { pages }, appletLayouts }, controlId) ? undefined : controlId;
}

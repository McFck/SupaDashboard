import type { Item } from './layout';
import type { Page } from './settings.svelte';

export function pageById(pages: readonly Page[], id: string | undefined) {
  return pages.find(page => page.id === id) ?? pages[0];
}

export function pageItems(pages: readonly Page[]): Item[] {
  return pages.flatMap(page => page.items);
}

export function placementById(pages: readonly Page[], itemId: string) {
  for (const page of pages) {
    const item = page.items.find(candidate => candidate.id === itemId);
    if (item) return { page, item };
  }
  return undefined;
}

export function hasPlacement(pages: readonly Page[], controlId: string) {
  return pages.some(page => page.items.some(item => item.control === controlId));
}

export function pageAfterRemoval(pages: readonly Page[], removedId: string, previousOrder: readonly string[]) {
  if (pages.some(page => page.id === removedId)) return removedId;
  if (!pages.length) return undefined;
  const oldIndex = previousOrder.indexOf(removedId);
  return pages[Math.min(Math.max(0, oldIndex), pages.length - 1)].id;
}

export function removePlacement(pages: readonly Page[], pageId: string, itemId: string) {
  const target = pages.find(page => page.id === pageId);
  const item = target?.items.find(candidate => candidate.id === itemId);
  if (!target || !item) return { pages: pages as Page[], item: undefined, orphanControl: undefined };
  const next = pages.map(page => page.id === pageId
    ? { ...page, items: page.items.filter(candidate => candidate.id !== itemId) }
    : page);
  return { pages: next, item, orphanControl: hasPlacement(next, item.control) ? undefined : item.control };
}

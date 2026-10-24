import type { Item } from './layout';
import { firstFree, fits } from './layout';
import type { ControlConfig } from './controls';
import type { Page, Settings } from './settings.svelte';

export const MAX_PAGES = 10;
export type PageChange = { pages: Page[] };
export type PageDeckChange = PageChange & { controls: ControlConfig[]; variants: Settings['variants'] };
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function nextPageName(pages: readonly Page[]) {
  const used = new Set(pages.map(page => page.name));
  for (let n = 1; ; n++) if (!used.has(`Page ${n}`)) return `Page ${n}`;
}

function newGlobalId(prefix: string, used: Set<string>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const id = `${prefix}-${crypto.randomUUID()}`;
    if (!used.has(id)) { used.add(id); return id; }
  }
  return undefined;
}

function allIds(pages: readonly Page[], controls: readonly ControlConfig[]) {
  return new Set([...pages.flatMap(page => [page.id, ...page.items.map(item => item.id)]), ...controls.map(control => control.id)]);
}

export function addPage(pages: readonly Page[], controls: readonly ControlConfig[], sourcePageId?: string) {
  if (pages.length >= MAX_PAGES) return undefined;
  const source = pageById(pages, sourcePageId);
  if (!source) return undefined;
  const id = newGlobalId('page', allIds(pages, controls));
  if (!id) return undefined;
  const page: Page = { id, name: nextPageName(pages), rows: source.rows, cols: source.cols, size: source.size,
    sizing: source.sizing, gap: source.gap, items: [] };
  return { pages: [...pages, page], page };
}

export function renamePage(pages: readonly Page[], pageId: string, name: string): PageChange | undefined {
  const target = pages.find(page => page.id === pageId), trimmed = name.trim();
  if (!target || !trimmed || target.name === trimmed) return undefined;
  return { pages: pages.map(page => page.id === pageId ? { ...page, name: trimmed } : page) };
}

export function duplicatePage(pages: readonly Page[], pageId: string, controls: readonly ControlConfig[], variants: Settings['variants']) {
  if (pages.length >= MAX_PAGES) return undefined;
  const source = pages.find(page => page.id === pageId);
  if (!source) return undefined;
  const sourceControls = new Map(controls.map(control => [control.id, control]));
  if (source.items.some(item => !sourceControls.has(item.control))) return undefined;
  const ids = allIds(pages, controls);
  const id = newGlobalId('page', ids);
  if (!id) return undefined;
  const copiedControls: ControlConfig[] = [];
  const copiedItems: Item[] = [];
  for (const item of source.items) {
    const control = sourceControls.get(item.control)!;
    const controlId = newGlobalId(control.id, ids), itemId = newGlobalId('item', ids);
    if (!controlId || !itemId) return undefined;
    copiedControls.push({ ...cloneJson(control), id: controlId });
    copiedItems.push({ ...item, id: itemId, control: controlId });
  }
  const page: Page = { ...cloneJson(source), id, name: `${source.name} copy`, items: copiedItems };
  return { pages: [...pages, page], page, controls: [...controls, ...copiedControls], variants: { ...variants } };
}

export function reorderPage(pages: readonly Page[], pageId: string, to: number): PageChange | undefined {
  const from = pages.findIndex(page => page.id === pageId);
  if (from < 0 || !Number.isInteger(to) || to < 0 || to >= pages.length || from === to) return undefined;
  const next = [...pages], [page] = next.splice(from, 1);
  next.splice(to, 0, page);
  return { pages: next };
}

export function deletePage(pages: readonly Page[], pageId: string, controls: readonly ControlConfig[], variants: Settings['variants']) {
  if (pages.length <= 1 || !pages.some(page => page.id === pageId)) return undefined;
  const next = pages.filter(page => page.id !== pageId);
  const usedControls = new Set(next.flatMap(page => page.items.map(item => item.control)));
  const removedControls = new Set(controls.filter(control => !usedControls.has(control.id)).map(control => control.id));
  const nextVariants = { ...variants };
  for (const id of removedControls) delete nextVariants[id];
  return { pages: next, controls: controls.filter(control => !removedControls.has(control.id)), variants: nextVariants };
}

export function movePlacement(pages: readonly Page[], sourcePageId: string, destinationPageId: string, itemId: string) {
  const source = pages.find(page => page.id === sourcePageId), destination = pages.find(page => page.id === destinationPageId);
  const item = source?.items.find(candidate => candidate.id === itemId);
  if (!source || !destination || source === destination || !item) return undefined;
  const position = fits(destination.items, item, destination) ? { x: item.x, y: item.y }
    : firstFree(destination.items, item.w, item.h, destination);
  if (!position) return undefined;
  const moved = { ...item, ...position };
  return { pages: pages.map(page => page.id === sourcePageId
    ? { ...page, items: page.items.filter(candidate => candidate.id !== itemId) }
    : page.id === destinationPageId ? { ...page, items: [...page.items, moved] } : page), item: moved };
}

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

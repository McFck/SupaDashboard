import type { ControlConfig } from '../controls/model';
import { firstFree, fits, type Grid, type Item } from './grid';
import { controlTypes, applets } from '../plugins/registry';
import type { Page, Settings } from '../settings/schema';
import type { AppletSlot } from '../applets/contracts';
import { DECK } from '../applets/deck';
import { storedPlacements } from './placements';

export type LayoutTarget = { appletId: string; pageId: string; slotId: string };
export type LayoutGeometry = Pick<Page, 'rows' | 'cols' | 'size' | 'gap' | 'sizing'>;
export type LayoutView = LayoutTarget & {
  page: Page;
  slot?: AppletSlot;
  geometry?: LayoutGeometry;
  items: Item[];
};
export type Placement = LayoutTarget & {
  item: Item;
  page?: Page;
  slot?: AppletSlot;
  geometry?: LayoutGeometry;
  width?: number;
  height?: number;
};
export type EffectiveSize = {
  min: { w: number; h: number };
  default: { w: number; h: number };
  max: { w: number; h: number };
};

const deckGeometry = (page: Page): LayoutGeometry => ({
  rows: page.rows,
  cols: page.cols,
  size: page.size,
  gap: page.gap,
  sizing: page.sizing,
});

function slotFor(appletId: string, slotId: string) {
  if (appletId === 'deck') {
    return DECK.slots.find((slot) => slot.id === slotId);
  }
  return applets.get(appletId)?.slots.find((slot) => slot.id === slotId);
}

function geometryFor(page: Page, slot: AppletSlot): LayoutGeometry {
  return slot.grid === 'page' ? deckGeometry(page) : slot.grid;
}

/** Reads a applet/page/slot without creating entries. Deck's main slot aliases Page.items. */
export function layoutFor(
  source: Settings,
  appletId: string,
  pageId: string,
  slotId: string,
): LayoutView | undefined {
  const page = source.deck.pages.find((entry) => entry.id === pageId);
  if (!page) return undefined;
  if (appletId === 'deck') {
    if (slotId !== 'main') return undefined;
    return {
      appletId,
      pageId,
      slotId,
      page,
      slot: slotFor(appletId, slotId),
      geometry: deckGeometry(page),
      items: page.items,
    };
  }
  const slot = slotFor(appletId, slotId);
  const items = source.appletLayouts?.[appletId]?.[pageId]?.[slotId] ?? [];
  return {
    appletId,
    pageId,
    slotId,
    page,
    slot,
    geometry: slot ? geometryFor(page, slot) : undefined,
    items,
  };
}

function sameTarget(target: LayoutTarget, current: LayoutTarget) {
  return (
    target.appletId === current.appletId &&
    target.pageId === current.pageId &&
    target.slotId === current.slotId
  );
}

/** Validates a prospective write without allocating IDs or changing settings. */
export function canSetLayoutItems(source: Settings, target: LayoutTarget, items: Item[]) {
  const current = layoutFor(source, target.appletId, target.pageId, target.slotId);
  if (!current || !sameTarget(target, current)) return false;
  const elsewhere = storedPlacements(source).filter((placement) => !sameTarget(target, placement));
  const otherItemIds = new Set(elsewhere.map((placement) => placement.item.id));
  const otherControlIds = new Set(elsewhere.map((placement) => placement.item.control));
  if (items.some((item) => otherItemIds.has(item.id) || otherControlIds.has(item.control)))
    return false;
  return (
    !!current.slot &&
    !!current.geometry &&
    validSlotItems(source, target.appletId, current.slot, current.geometry, items)
  );
}

/** The only layout writer; it resolves stable IDs again before replacing the addressed array. */
export function setLayoutItems(source: Settings, target: LayoutTarget, items: Item[]) {
  const current = layoutFor(source, target.appletId, target.pageId, target.slotId);
  if (!current || !canSetLayoutItems(source, target, items)) return false;
  if (source.appletLayouts) delete source.appletLayouts.deck;
  if (target.appletId === 'deck') {
    current.page.items = items;
    return true;
  }
  source.appletLayouts ??= {};
  source.appletLayouts[target.appletId] ??= {};
  source.appletLayouts[target.appletId][target.pageId] ??= {};
  source.appletLayouts[target.appletId][target.pageId][target.slotId] = items;
  return true;
}

/** Moves one placement between registered applet/page/slot targets without changing its IDs or control. */
export function movePlacementToSlot(source: Settings, itemId: string, destination: LayoutTarget) {
  const origin = storedPlacements(source).find((placement) => placement.item.id === itemId);
  const from = origin && layoutFor(source, origin.appletId, origin.pageId, origin.slotId);
  const to = layoutFor(source, destination.appletId, destination.pageId, destination.slotId);
  if (!origin || !from || !to?.slot || !to.geometry || sameTarget(origin, destination))
    return undefined;
  const control = source.controls.find((entry) => entry.id === origin.item.control);
  const bounds = control && effectiveSize(destination.appletId, to.slot, control.type);
  if (!bounds || (to.slot.max !== undefined && to.items.length >= to.slot.max)) return undefined;
  const w = Math.min(bounds.max.w, Math.max(bounds.min.w, origin.item.w));
  const h = Math.min(bounds.max.h, Math.max(bounds.min.h, origin.item.h));
  const grid = { rows: to.geometry.rows, cols: to.geometry.cols };
  const preferred = { x: origin.item.x, y: origin.item.y, w, h };
  const position = fits(to.items, preferred, grid)
    ? { x: preferred.x, y: preferred.y }
    : firstFree(to.items, w, h, grid);
  if (!position) return undefined;
  const moved = { ...origin.item, ...position, w, h };

  // setLayoutItems writes into the page or slot map it is given, so every container is copied first.
  const pages = source.deck.pages.map((page) => ({
    ...page,
    items:
      page.id === origin.pageId && origin.appletId === 'deck'
        ? page.items.filter((item) => item.id !== itemId)
        : page.items,
  }));
  const appletLayouts: Settings['appletLayouts'] = {};
  for (const [appletId, byPage] of Object.entries(source.appletLayouts ?? {})) {
    if (appletId === 'deck') {
      continue;
    }
    appletLayouts[appletId] = Object.fromEntries(
      Object.entries(byPage).map(([pageId, slots]) => [pageId, { ...slots }]),
    );
  }
  if (origin.appletId !== 'deck') {
    appletLayouts[origin.appletId][origin.pageId][origin.slotId] = from.items.filter(
      (item) => item.id !== itemId,
    );
  }
  const next = { ...source, deck: { ...source.deck, pages }, appletLayouts } as Settings;
  if (!setLayoutItems(next, destination, [...to.items, moved])) return undefined;
  return {
    pages: next.deck.pages,
    appletLayouts: next.appletLayouts,
    item: moved,
    origin,
    destination,
  };
}

/** One stored placement with its page, registered slot and pixel size, when those still resolve. */
export function placementById(source: Settings, itemId: string): Placement | undefined {
  const placement = storedPlacements(source).find((entry) => entry.item.id === itemId);
  if (!placement) {
    return undefined;
  }
  const { item } = placement;
  const page = source.deck.pages.find((entry) => entry.id === placement.pageId);
  const slot = slotFor(placement.appletId, placement.slotId);
  let geometry: LayoutGeometry | undefined;
  if (page && placement.appletId === 'deck') {
    geometry = deckGeometry(page);
  } else if (page && slot) {
    geometry = geometryFor(page, slot);
  }
  if (!geometry) {
    return { ...placement, page, slot };
  }
  return {
    ...placement,
    page,
    slot,
    geometry,
    width: item.w * geometry.size + (item.w - 1) * geometry.gap,
    height: item.h * geometry.size + (item.h - 1) * geometry.gap,
  };
}

function bounded(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function effectiveSize(
  appletId: string,
  slot: AppletSlot,
  typeId: string,
): EffectiveSize | undefined {
  const type = controlTypes.get(typeId);
  if (!type) return undefined;
  const override = applets.get(appletId)?.controlFaces?.[typeId]?.sizes?.[slot.id];
  // A applet may raise the type's minimum, never lower it: below it the widget cannot draw itself.
  const floor = type.minSize ?? { w: 1, h: 1 };
  const min = {
    w: Math.max(floor.w, override?.min?.w ?? 1),
    h: Math.max(floor.h, override?.min?.h ?? 1),
  };
  const preferred = override?.default ?? type.size;
  const gridCapacity =
    slot.grid === 'page' ? { w: Infinity, h: Infinity } : { w: slot.grid.cols, h: slot.grid.rows };
  const max = {
    w: Math.min(override?.max?.w ?? type.maxSize?.w ?? Infinity, gridCapacity.w),
    h: Math.min(override?.max?.h ?? type.maxSize?.h ?? Infinity, gridCapacity.h),
  };
  const fixed = slot.size;
  if (fixed && (fixed.w < min.w || fixed.h < min.h || fixed.w > max.w || fixed.h > max.h))
    return undefined;
  const finalMin = fixed ?? min;
  const finalMax = fixed ?? max;
  const defaultSize = {
    w: bounded(preferred.w, finalMin.w, finalMax.w),
    h: bounded(preferred.h, finalMin.h, finalMax.h),
  };
  if (
    ![finalMin.w, finalMin.h, defaultSize.w, defaultSize.h].every((value) =>
      Number.isSafeInteger(value),
    ) ||
    [finalMax.w, finalMax.h].some((value) => value !== Infinity && !Number.isSafeInteger(value))
  )
    return undefined;
  return { min: finalMin, default: defaultSize, max: finalMax };
}

function validItem(item: Item) {
  return (
    !!item &&
    typeof item.id === 'string' &&
    !!item.id &&
    typeof item.control === 'string' &&
    !!item.control &&
    [item.x, item.y, item.w, item.h].every(Number.isSafeInteger) &&
    item.x >= 0 &&
    item.y >= 0 &&
    item.w > 0 &&
    item.h > 0
  );
}

function validSlotItems(
  source: Settings,
  appletId: string,
  slot: AppletSlot,
  geometry: LayoutGeometry,
  items: readonly Item[],
) {
  const grid: Grid = { rows: geometry.rows, cols: geometry.cols };
  if (slot.max !== undefined && items.length > slot.max) return false;
  const seenItems = new Set<string>(),
    seenControls = new Set<string>(),
    accepted = slot.accepts && new Set(slot.accepts);
  const placed: Item[] = [];
  for (const item of items) {
    if (!validItem(item) || seenItems.has(item.id) || seenControls.has(item.control)) return false;
    const control: ControlConfig | undefined = source.controls.find(
      (entry) => entry.id === item.control,
    );
    if (!control || (accepted && !accepted.has(control.type))) return false;
    const bounds = effectiveSize(appletId, slot, control.type);
    if (
      !bounds ||
      item.w < bounds.min.w ||
      item.h < bounds.min.h ||
      item.w > bounds.max.w ||
      item.h > bounds.max.h
    )
      return false;
    if (!fits(placed, item, grid)) return false;
    seenItems.add(item.id);
    seenControls.add(item.control);
    placed.push(item);
  }
  return true;
}

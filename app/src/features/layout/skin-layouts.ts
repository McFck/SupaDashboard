import type { ControlConfig } from '../controls/model';
import { firstFree, fits, type Grid, type Item } from './grid';
import { controlTypes, skins } from '../plugins/registry';
import type { Page, Settings } from '../settings/schema';
import type { SkinSlot } from '../skins/contracts';
import { storedPlacements } from './placements';

export type LayoutTarget = { skinId: string; pageId: string; slotId: string };
export type LayoutGeometry = Pick<Page, 'rows' | 'cols' | 'size' | 'gap' | 'sizing'>;
export type LayoutView = LayoutTarget & {
  page: Page;
  slot?: SkinSlot;
  geometry?: LayoutGeometry;
  items: Item[];
};
export type Placement = LayoutTarget & {
  item: Item;
  page?: Page;
  slot?: SkinSlot;
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

function slotFor(skinId: string, slotId: string) {
  if (skinId === 'deck' && slotId === 'main')
    return (
      skins.get(skinId)?.slots.find((slot) => slot.id === slotId) ??
      ({ id: 'main', style: 'region', kind: 'grid', grid: 'page' } as SkinSlot)
    );
  return skins.get(skinId)?.slots.find((slot) => slot.id === slotId);
}

function geometryFor(page: Page, slot: SkinSlot): LayoutGeometry {
  return slot.grid === 'page' ? deckGeometry(page) : slot.grid;
}

/** Reads a skin/page/slot without creating entries. Deck's main slot aliases Page.items. */
export function layoutFor(
  source: Settings,
  skinId: string,
  pageId: string,
  slotId: string,
): LayoutView | undefined {
  const page = source.deck.pages.find((entry) => entry.id === pageId);
  if (!page) return undefined;
  if (skinId === 'deck') {
    if (slotId !== 'main') return undefined;
    return {
      skinId,
      pageId,
      slotId,
      page,
      slot: slotFor(skinId, slotId),
      geometry: deckGeometry(page),
      items: page.items,
    };
  }
  const slot = slotFor(skinId, slotId);
  const items = source.skinLayouts?.[skinId]?.[pageId]?.[slotId] ?? [];
  return {
    skinId,
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
    target.skinId === current.skinId &&
    target.pageId === current.pageId &&
    target.slotId === current.slotId
  );
}

/** Validates a prospective write without allocating IDs or changing settings. */
export function canSetLayoutItems(source: Settings, target: LayoutTarget, items: Item[]) {
  const current = layoutFor(source, target.skinId, target.pageId, target.slotId);
  if (!current || !sameTarget(target, current)) return false;
  const elsewhere = storedPlacements(source).filter((placement) => !sameTarget(target, placement));
  const otherItemIds = new Set(elsewhere.map((placement) => placement.item.id));
  const otherControlIds = new Set(elsewhere.map((placement) => placement.item.control));
  if (items.some((item) => otherItemIds.has(item.id) || otherControlIds.has(item.control)))
    return false;
  return (
    !!current.slot &&
    !!current.geometry &&
    validSlotItems(source, target.skinId, current.slot, current.geometry, items)
  );
}

/** The only layout writer; it resolves stable IDs again before replacing the addressed array. */
export function setLayoutItems(source: Settings, target: LayoutTarget, items: Item[]) {
  const current = layoutFor(source, target.skinId, target.pageId, target.slotId);
  if (!current || !canSetLayoutItems(source, target, items)) return false;
  if (source.skinLayouts) delete source.skinLayouts.deck;
  if (target.skinId === 'deck') {
    current.page.items = items;
    return true;
  }
  source.skinLayouts ??= {};
  source.skinLayouts[target.skinId] ??= {};
  source.skinLayouts[target.skinId][target.pageId] ??= {};
  source.skinLayouts[target.skinId][target.pageId][target.slotId] = items;
  return true;
}

/** Moves one placement between registered skin/page/slot targets without changing its IDs or control. */
export function movePlacementToSlot(source: Settings, itemId: string, destination: LayoutTarget) {
  const origin = storedPlacements(source).find((placement) => placement.item.id === itemId);
  const from = origin && layoutFor(source, origin.skinId, origin.pageId, origin.slotId);
  const to = layoutFor(source, destination.skinId, destination.pageId, destination.slotId);
  if (!origin || !from || !to?.slot || !to.geometry || sameTarget(origin, destination))
    return undefined;
  const control = source.controls.find((entry) => entry.id === origin.item.control);
  const bounds = control && effectiveSize(destination.skinId, to.slot, control.type);
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
      page.id === origin.pageId && origin.skinId === 'deck'
        ? page.items.filter((item) => item.id !== itemId)
        : page.items,
  }));
  const skinLayouts: Settings['skinLayouts'] = {};
  for (const [skinId, byPage] of Object.entries(source.skinLayouts ?? {})) {
    if (skinId === 'deck') {
      continue;
    }
    skinLayouts[skinId] = Object.fromEntries(
      Object.entries(byPage).map(([pageId, slots]) => [pageId, { ...slots }]),
    );
  }
  if (origin.skinId !== 'deck') {
    skinLayouts[origin.skinId][origin.pageId][origin.slotId] = from.items.filter(
      (item) => item.id !== itemId,
    );
  }
  const next = { ...source, deck: { ...source.deck, pages }, skinLayouts } as Settings;
  if (!setLayoutItems(next, destination, [...to.items, moved])) return undefined;
  return {
    pages: next.deck.pages,
    skinLayouts: next.skinLayouts,
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
  const slot = slotFor(placement.skinId, placement.slotId);
  let geometry: LayoutGeometry | undefined;
  if (page && placement.skinId === 'deck') {
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
  skinId: string,
  slot: SkinSlot,
  typeId: string,
): EffectiveSize | undefined {
  const type = controlTypes.get(typeId);
  if (!type) return undefined;
  const override = skins.get(skinId)?.controlSkins?.[typeId]?.sizes?.[slot.id];
  // A skin may raise the type's minimum, never lower it: below it the widget cannot draw itself.
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
  skinId: string,
  slot: SkinSlot,
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
    const bounds = effectiveSize(skinId, slot, control.type);
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

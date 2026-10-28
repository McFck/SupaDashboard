// Pasting, duplicating and replacing a widget in a slot: whether it fits there and the settings that result.
import type { Settings } from '../settings/schema';
import { fits, type Item } from './grid';
import { pasteWidget, type WidgetCopy } from './layout-actions';
import { removePlacement } from './placements';
import { effectiveSize, layoutFor, setLayoutItems, type LayoutTarget } from './skin-layouts';

export type InsertTarget = { item: string } | { cell: { x: number; y: number } };

/** Where `copy` lands in `slot` (on an empty cell, or over `target.item` when replacing), if it is allowed there. */
export function planInsertion(
  source: Settings,
  copy: WidgetCopy,
  target: InsertTarget,
  slot: LayoutTarget,
  replace: boolean,
) {
  const current = layoutFor(source, slot.skinId, slot.pageId, slot.slotId);
  if (!current?.slot || !current.geometry) {
    return undefined;
  }
  const old = 'item' in target ? current.items.find((item) => item.id === target.item) : undefined;
  if (('item' in target && !old) || (old && !replace)) {
    return undefined;
  }
  const at = 'cell' in target ? target.cell : old;
  const bounds = effectiveSize(slot.skinId, current.slot, copy.control.type);
  const remaining = old ? current.items.filter((item) => item.id !== old.id) : current.items;
  if (!at || !bounds) {
    return undefined;
  }
  const accepted = !current.slot.accepts || current.slot.accepts.includes(copy.control.type);
  const sized =
    copy.w >= bounds.min.w &&
    copy.h >= bounds.min.h &&
    copy.w <= bounds.max.w &&
    copy.h <= bounds.max.h;
  const roomInSlot = current.slot.max === undefined || remaining.length < current.slot.max;
  if (!accepted || !sized || !roomInSlot) {
    return undefined;
  }
  if (!fits(remaining, { ...at, w: copy.w, h: copy.h }, current.geometry)) {
    return undefined;
  }
  return { geometry: current.geometry, old, at, remaining };
}

export type InsertionPlan = NonNullable<ReturnType<typeof planInsertion>>;

/**
 * The settings after placing a fresh copy of `copy` per `plan`. A replaced widget's control is dropped when no
 * other placement uses it. `source` must be a plain snapshot; the result shares no objects with live settings.
 */
export function insertWidget(
  source: Settings,
  copy: WidgetCopy,
  plan: InsertionPlan,
  slot: LayoutTarget,
  allItems: Item[],
) {
  const pasted = pasteWidget(
    copy,
    plan.remaining,
    allItems,
    source.controls,
    plan.geometry,
    plan.at,
  );
  if (!pasted) {
    return undefined;
  }

  let pages = source.deck.pages;
  let skinLayouts = source.skinLayouts;
  let controls = source.controls;
  const variants = { ...source.variants };
  if (plan.old) {
    const removed = removePlacement(pages, slot.pageId, plan.old.id, skinLayouts);
    if (!removed.item) {
      return undefined;
    }
    pages = removed.pages;
    skinLayouts = removed.skinLayouts;
    if (removed.orphanControl) {
      controls = controls.filter((control) => control.id !== removed.orphanControl);
      delete variants[removed.orphanControl];
    }
  }

  const draft: Settings = {
    ...source,
    deck: { ...source.deck, pages: pages.map((page) => ({ ...page, items: [...page.items] })) },
    skinLayouts,
    controls: [...controls, pasted.control],
    variants,
  };
  const destination = layoutFor(draft, slot.skinId, slot.pageId, slot.slotId);
  if (!destination || !setLayoutItems(draft, slot, [...destination.items, pasted.item])) {
    return undefined;
  }
  return { settings: draft, itemId: pasted.item.id };
}

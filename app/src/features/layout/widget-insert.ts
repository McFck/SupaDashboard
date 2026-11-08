// Pasting a widget copy into a slot, on an empty cell or over the placement it replaces: whether it is allowed there
// and the settings that result.
import type { ControlConfig } from '../controls/model';
import type { Settings } from '../settings/schema';
import { newId } from '../settings/state.svelte';
import { clonePlain } from '../automation/plain-data';
import { fits } from './grid';
import { pageItems, removePlacement } from './placements';
import { effectiveSize, layoutFor, setLayoutItems, type LayoutTarget } from './applet-layouts';

export type WidgetCopy = { control: ControlConfig; w: number; h: number };
export type InsertTarget = { item: string } | { cell: { x: number; y: number } };

/** Where `copy` lands in `slot`: on `target.cell`, or over `target.item`, which it replaces. */
export function planInsertion(
  source: Settings,
  copy: WidgetCopy,
  target: InsertTarget,
  slot: LayoutTarget,
) {
  const current = layoutFor(source, slot.appletId, slot.pageId, slot.slotId);
  if (!current?.slot || !current.geometry) {
    return undefined;
  }
  const old = 'item' in target ? current.items.find((item) => item.id === target.item) : undefined;
  // Only the cell: spreading the replaced item would carry its ID and control into the pasted placement.
  const at = 'cell' in target ? target.cell : old && { x: old.x, y: old.y };
  const bounds = effectiveSize(slot.appletId, current.slot, copy.control.type);
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
  return { old, at };
}

type InsertionPlan = NonNullable<ReturnType<typeof planInsertion>>;

/**
 * The settings after placing a fresh copy of `copy` per `plan`, which must have been made from the same `source`.
 * A replaced widget's control is dropped when no other placement uses it. `source` must be a plain snapshot: the
 * result reuses its objects and the write lands in its slot maps.
 */
export function insertWidget(
  source: Settings,
  copy: WidgetCopy,
  plan: InsertionPlan,
  slot: LayoutTarget,
) {
  const control = {
    ...clonePlain(copy.control),
    id: newId(
      copy.control.id,
      source.controls.map((entry) => entry.id),
    ),
  };
  const item = {
    id: newId(
      'i',
      pageItems(source.deck.pages, source.appletLayouts).map((entry) => entry.id),
    ),
    control: control.id,
    ...plan.at,
    w: copy.w,
    h: copy.h,
  };

  let pages = source.deck.pages;
  let appletLayouts = source.appletLayouts;
  let controls = source.controls;
  const variants = { ...source.variants };
  if (plan.old) {
    const removed = removePlacement(pages, slot.pageId, plan.old.id, appletLayouts);
    if (!removed.item) {
      return undefined;
    }
    pages = removed.pages;
    appletLayouts = removed.appletLayouts;
    if (removed.orphanControl) {
      controls = controls.filter((entry) => entry.id !== removed.orphanControl);
      delete variants[removed.orphanControl];
    }
  }

  const draft: Settings = {
    ...source,
    deck: { ...source.deck, pages: pages.map((page) => ({ ...page, items: [...page.items] })) },
    appletLayouts,
    controls: [...controls, control],
    variants,
  };
  const destination = layoutFor(draft, slot.appletId, slot.pageId, slot.slotId);
  if (!destination || !setLayoutItems(draft, slot, [...destination.items, item])) {
    return undefined;
  }
  return { settings: draft, itemId: item.id };
}

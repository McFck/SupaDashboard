// Inspector edits of one slot's placements, applied to the live settings as one undo step each.
import type { ControlConfig } from '../controls/model';
import { newId, settings } from '../settings/state.svelte';
import { commit } from './history.svelte';
import { firstFree, fits, inside, type Item } from './grid';
import { pageItems, removePlacement } from './pages';
import {
  canSetLayoutItems,
  effectiveSize,
  layoutFor,
  setLayoutItems,
  type LayoutTarget,
} from './skin-layouts';

type Cell = { x: number; y: number };
type Size = { w: number; h: number };

const slotOf = (target: LayoutTarget) =>
  layoutFor(settings, target.skinId, target.pageId, target.slotId);

/**
 * Where a widget of `typeId` can go in the slot: on `cell` when it fits there, else the first free spot. The size
 * defaults to the type's default for this slot.
 */
export function findSlotPlacement(
  target: LayoutTarget,
  typeId: string,
  options: { cell?: Cell; size?: Size } = {},
) {
  const current = slotOf(target);
  const slot = current?.slot;
  const geometry = current?.geometry;
  if (!current || !slot || !geometry) {
    return null;
  }
  const occupied = current.items;
  const accepted = !slot.accepts || slot.accepts.includes(typeId);
  const full = slot.max !== undefined && occupied.length >= slot.max;
  const bounds = effectiveSize(target.skinId, slot, typeId);
  if (!accepted || full || !bounds) {
    return null;
  }
  const w = options.size?.w ?? bounds.default.w;
  const h = options.size?.h ?? bounds.default.h;
  if (w < bounds.min.w || h < bounds.min.h || w > bounds.max.w || h > bounds.max.h) {
    return null;
  }
  const cell = options.cell;
  const at =
    cell && fits(occupied, { ...cell, w, h }, geometry)
      ? cell
      : firstFree(occupied, w, h, geometry);
  return at ? { ...at, w, h } : null;
}

/** Replaces the slot's placements, adding `addedControl` with them, if the result is a valid layout. */
export function writeSlotItems(
  target: LayoutTarget,
  items: Item[],
  label: string,
  addedControl?: ControlConfig,
) {
  const controls = addedControl ? [...settings.controls, addedControl] : settings.controls;
  if (!canSetLayoutItems({ ...settings, controls }, target, items)) {
    return false;
  }
  commit(label);
  if (addedControl) {
    settings.controls.push(addedControl);
  }
  if (setLayoutItems(settings, target, items)) {
    return true;
  }
  if (addedControl) {
    settings.controls = settings.controls.filter((entry) => entry.id !== addedControl.id);
  }
  return false;
}

/** Adds a placement of `control` (new to settings) at `at`; returns the placement ID, or undefined if refused. */
export function placeControl(
  target: LayoutTarget,
  control: ControlConfig,
  at: Cell & Size,
  label: string,
) {
  const takenIds = pageItems(settings.deck.pages, settings.skinLayouts).map((item) => item.id);
  const id = newId('i', takenIds);
  const items = [...(slotOf(target)?.items ?? []), { id, control: control.id, ...at }];
  return writeSlotItems(target, items, label, control) ? id : undefined;
}

/** A control ID derived from `base` that no control uses yet. */
export function newControlId(base: string) {
  return newId(
    base,
    settings.controls.map((control) => control.id),
  );
}

export function resizeInSlot(target: LayoutTarget, itemId: string, size: Size) {
  const current = slotOf(target);
  const item = current?.items.find((entry) => entry.id === itemId);
  const control = item && settings.controls.find((entry) => entry.id === item.control);
  const bounds =
    control && current?.slot && effectiveSize(target.skinId, current.slot, control.type);
  if (!current || !item || !bounds || !current.geometry) {
    return false;
  }
  const { w, h } = size;
  const withinBounds =
    w >= bounds.min.w && h >= bounds.min.h && w <= bounds.max.w && h <= bounds.max.h;
  if (
    !withinBounds ||
    !fits(current.items, { x: item.x, y: item.y, w, h }, current.geometry, [item.id])
  ) {
    return false;
  }
  const next = current.items.map((entry) => (entry.id === item.id ? { ...entry, w, h } : entry));
  return writeSlotItems(target, next, 'Resize widget');
}

/** Deletes a placement, and its control when no other placement uses it. */
export function removeFromSlot(target: LayoutTarget, itemId: string, label: string) {
  if (!slotOf(target)?.items.some((entry) => entry.id === itemId)) {
    return false;
  }
  commit(label);
  return deletePlacement(target.pageId, itemId);
}

/**
 * Finishes a rows/columns change of a deck page that started at `from`. Widgets left outside the grid are deleted
 * like any other deletion (a control goes with its last placement), in one undo step with the resize. Keeping them
 * would strand configured controls that no picker shows and the next page deletion would silently discard.
 */
export function finishGridResize(pageId: string, from: { rows: number; cols: number }) {
  const page = settings.deck.pages.find((entry) => entry.id === pageId);
  const outside = page ? page.items.filter((item) => !inside(item, page)) : [];
  if (!page || !outside.length) {
    return;
  }
  const to = { rows: page.rows, cols: page.cols };
  // Rewind to the start of the gesture so undo brings back the size and the widgets together.
  Object.assign(page, from);
  commit(outside.length === 1 ? 'Delete widget' : `Delete ${outside.length} widgets`);
  Object.assign(page, to);
  for (const item of outside) {
    deletePlacement(pageId, item.id);
  }
}

function deletePlacement(pageId: string, itemId: string) {
  const result = removePlacement(settings.deck.pages, pageId, itemId, settings.skinLayouts);
  if (!result.item) {
    return false;
  }
  settings.deck.pages = result.pages;
  settings.skinLayouts = result.skinLayouts;
  if (result.orphanControl) {
    settings.controls = settings.controls.filter((entry) => entry.id !== result.orphanControl);
    delete settings.variants[result.orphanControl];
  }
  return true;
}

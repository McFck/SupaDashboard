// Checked placement commands on the live settings, one undo step each: add, write, resize, duplicate, paste, move
// and delete. Each validates before it records the undo step. Confirmations and selection stay with the UI.
import type { ControlConfig } from '../controls/model';
import { newId, settings } from '../settings/state.svelte';
import { commit } from './history.svelte';
import { clampResizeRect, firstFree, fits, inside, type Item, type Rect } from './grid';
import { controlUseCount, pageItems, removePlacement } from './placements';
import { removeItem } from './removal';
import {
  canSetLayoutItems,
  effectiveSize,
  layoutFor,
  movePlacementToSlot,
  setLayoutItems,
  type LayoutTarget,
} from './applet-layouts';
import { insertWidget, planInsertion, type InsertTarget, type WidgetCopy } from './widget-insert';
import { clonePlain } from '../automation/plain-data';

export const NO_ROOM = 'No free space for this widget';

type Cell = { x: number; y: number };
type Size = { w: number; h: number };

const slotOf = (target: LayoutTarget) =>
  layoutFor(settings, target.appletId, target.pageId, target.slotId);

/**
 * An explicit size must fit as given. For a new widget, try its default throughout the slot before
 * shrinking to the largest free rectangle. Prefer the requested cell among equally sized fits.
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
  const bounds = effectiveSize(target.appletId, slot, typeId);
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
  if (at) {
    return { ...at, w, h };
  }
  if (options.size) {
    return null;
  }

  const { min } = bounds;
  const largestAt = ({ x, y }: Cell) =>
    clampResizeRect(
      { x, y, w: Math.min(w, geometry.cols - x), h: Math.min(h, geometry.rows - y) },
      occupied,
      'se',
      min,
    );
  let best: Rect | null = cell && inside({ ...cell, ...min }, geometry) ? largestAt(cell) : null;
  for (let y = 0; y + min.h <= geometry.rows; y++) {
    for (let x = 0; x + min.w <= geometry.cols; x++) {
      const candidate = largestAt({ x, y });
      if (candidate && (!best || candidate.w * candidate.h > best.w * best.h)) {
        best = candidate;
      }
    }
  }
  return best;
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
  const takenIds = pageItems(settings.deck.pages, settings.appletLayouts).map((item) => item.id);
  const id = newId('i', takenIds);
  const items = [...(slotOf(target)?.items ?? []), { id, control: control.id, ...at }];
  return writeSlotItems(target, items, label, control) ? id : undefined;
}

/** Adds a linked placement of an existing control at `at`; returns the placement ID, or undefined if refused. */
export function placeLinkedControl(
  target: LayoutTarget,
  controlId: string,
  at: Cell & Size,
  label: string,
) {
  if (!settings.controls.some((entry) => entry.id === controlId)) {
    return undefined;
  }
  const takenIds = pageItems(settings.deck.pages, settings.appletLayouts).map((item) => item.id);
  const id = newId('i', takenIds);
  const items = [...(slotOf(target)?.items ?? []), { id, control: controlId, ...at }];
  return writeSlotItems(target, items, label) ? id : undefined;
}

/** A control ID derived from `base` that no control uses yet. */
export function newControlId(base: string) {
  return newId(
    base,
    settings.controls.map((control) => control.id),
  );
}

/** Detaches a linked placement into its own copy of the control; returns the new control ID, or undefined. */
export function unlinkPlacement(target: LayoutTarget, itemId: string) {
  const current = slotOf(target);
  const item = current?.items.find((entry) => entry.id === itemId);
  const control = item && settings.controls.find((entry) => entry.id === item.control);
  if (!current || !item || !control || controlUseCount(settings, control.id) < 2) {
    return undefined;
  }
  const copy: ControlConfig = {
    ...clonePlain(control),
    id: newControlId(control.name),
  };
  const nextItems = current.items.map((entry) =>
    entry.id === item.id ? { ...entry, control: copy.id } : entry,
  );
  if (!writeSlotItems(target, nextItems, `Make ${control.name} unique`, copy)) {
    return undefined;
  }
  if (Object.hasOwn(settings.variants, control.id)) {
    settings.variants[copy.id] = settings.variants[control.id];
  }
  return copy.id;
}

export function resizeInSlot(target: LayoutTarget, itemId: string, size: Size) {
  const current = slotOf(target);
  const item = current?.items.find((entry) => entry.id === itemId);
  const control = item && settings.controls.find((entry) => entry.id === item.control);
  const bounds =
    control && current?.slot && effectiveSize(target.appletId, current.slot, control.type);
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

/** Places a linked copy of a widget into a free spot of the same slot; returns the new placement ID. */
export function duplicateInSlot(target: LayoutTarget, itemId: string) {
  const item = slotOf(target)?.items.find((entry) => entry.id === itemId);
  const control = item && settings.controls.find((entry) => entry.id === item.control);
  const at =
    item && control && findSlotPlacement(target, control.type, { size: { w: item.w, h: item.h } });
  if (!control || !at) {
    return undefined;
  }
  return placeLinkedControl(target, control.id, at, `Duplicate ${control.name}`);
}

/** Pastes a widget on an empty cell or over the placement it replaces; returns the new placement ID. */
export function pasteInSlot(
  target: LayoutTarget,
  copy: WidgetCopy,
  at: InsertTarget,
  label: string,
  mode: 'copy' | 'link' = 'copy',
) {
  // The plan and the insertion use one plain snapshot: the insertion writes into the slot maps it is given.
  const source = clonePlain(settings);
  const plan = planInsertion(source, copy, at, target);
  const result = plan && insertWidget(source, copy, plan, target, mode);
  if (!result) {
    return undefined;
  }
  commit(label);
  settings.deck.pages = result.settings.deck.pages;
  settings.appletLayouts = result.settings.appletLayouts;
  settings.controls = result.settings.controls;
  settings.variants = result.settings.variants;
  return result.itemId;
}

/** Moves a placement to another slot or page, keeping its IDs and control; returns the moved placement. */
export function moveToSlot(itemId: string, destination: LayoutTarget) {
  const result = movePlacementToSlot(settings, itemId, destination);
  if (!result) {
    return undefined;
  }
  const page = settings.deck.pages.find((entry) => entry.id === destination.pageId);
  commit(page ? `Move widget to ${page.name}` : 'Move widget');
  settings.deck.pages = result.pages;
  settings.appletLayouts = result.appletLayouts;
  return result.item;
}

/**
 * Plays the removal dust, then deletes the placement, and its control when no other placement uses it, if
 * `stillShown()` holds once the dust ends.
 */
export function removeWithDust(target: LayoutTarget, itemId: string, stillShown: () => boolean) {
  const item = slotOf(target)?.items.find((entry) => entry.id === itemId);
  if (!item) {
    return Promise.resolve(false);
  }
  const name = settings.controls.find((entry) => entry.id === item.control)?.name ?? 'widget';
  return removeItem(itemId, () => {
    if (!stillShown() || !slotOf(target)?.items.some((entry) => entry.id === itemId)) {
      return false;
    }
    commit(`Delete ${name}`);
    return deletePlacement(target.pageId, itemId);
  });
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
  const result = removePlacement(settings.deck.pages, pageId, itemId, settings.appletLayouts);
  if (!result.item) {
    return false;
  }
  settings.deck.pages = result.pages;
  settings.appletLayouts = result.appletLayouts;
  if (result.orphanControl) {
    settings.controls = settings.controls.filter((entry) => entry.id !== result.orphanControl);
    delete settings.variants[result.orphanControl];
  }
  return true;
}

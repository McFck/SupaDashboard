import type { ControlConfig } from '../controls/model';
import { firstFree, fits, type Item, type Grid } from './grid';

export type WidgetCopy = { control: ControlConfig; w: number; h: number };
export const cloneControl = (control: ControlConfig): ControlConfig => JSON.parse(JSON.stringify(control));
const idFor = (base: string, ids: string[]) => {
  let id = base, n = 2;
  while (ids.includes(id)) id = `${base}-${n++}`;
  return id;
};

export function duplicateWidget(copy: WidgetCopy, items: Item[], allItems: Item[], controls: ControlConfig[], grid: Grid) {
  const at = firstFree(items, copy.w, copy.h, grid);
  return at ? pasteWidget(copy, items, allItems, controls, grid, at) : null;
}

export function pasteWidget(copy: WidgetCopy, items: Item[], allItems: Item[], controls: ControlConfig[], grid: Grid,
  at: { x: number; y: number }, replace?: string) {
  if (!fits(items, { ...at, w: copy.w, h: copy.h }, grid, replace ? [replace] : [])) return null;
  const control = { ...cloneControl(copy.control), id: idFor(copy.control.id, controls.map(c => c.id)) };
  const item = { id: idFor('i', allItems.map(i => i.id)), control: control.id, ...at, w: copy.w, h: copy.h };
  return { control, item };
}

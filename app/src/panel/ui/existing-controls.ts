export type ExistingControl = { id: string; name: string; type: string };
export type ExistingPlacement = { w: number; h: number };
export type ExistingType = { title: string; icon: string; size: ExistingPlacement };
export type ExistingControlRow<T extends ExistingControl = ExistingControl> = {
  control: T;
  id: string;
  name: string;
  typeId: string;
  typeTitle: string;
  icon: string;
  size?: ExistingPlacement;
  available: boolean;
  uses: number;
};

export function buildExistingControlRows<T extends ExistingControl>(
  controls: readonly T[],
  items: readonly { control: string }[],
  types: ReadonlyMap<string, ExistingType>,
): ExistingControlRow<T>[] {
  const uses = new Map<string, number>();
  for (const item of items) uses.set(item.control, (uses.get(item.control) ?? 0) + 1);

  return controls.map(control => {
    const type = types.get(control.type);
    return {
      control,
      id: control.id,
      name: control.name,
      typeId: control.type,
      typeTitle: type?.title ?? control.type,
      icon: type?.icon ?? 'Puzzle',
      size: type?.size,
      available: !!type,
      uses: uses.get(control.id) ?? 0,
    };
  }).sort((a, b) => {
    const left = a.name.toLowerCase(), right = b.name.toLowerCase();
    return (left < right ? -1 : left > right ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

export function searchExistingControls<T extends ExistingControl>(rows: readonly ExistingControlRow<T>[], query: string): ExistingControlRow<T>[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(row => row.name.toLowerCase().includes(needle) || row.typeId.toLowerCase().includes(needle) || row.typeTitle.toLowerCase().includes(needle));
}

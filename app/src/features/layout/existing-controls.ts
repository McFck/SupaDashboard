type ExistingControl = { id: string; name: string; type: string };
type ExistingType = { title: string; icon: string };
export type ExistingControlRow = {
  id: string;
  name: string;
  typeId: string;
  typeTitle: string;
  icon: string;
  available: boolean;
  uses: number;
};

/** Sorts by name (case-insensitive, code-point order), then by ID. */
function compareRows(a: ExistingControlRow, b: ExistingControlRow) {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  if (left !== right) {
    return left < right ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

export function buildExistingControlRows(
  controls: readonly ExistingControl[],
  items: readonly { control: string }[],
  types: ReadonlyMap<string, ExistingType>,
): ExistingControlRow[] {
  const uses = new Map<string, number>();
  for (const item of items) {
    uses.set(item.control, (uses.get(item.control) ?? 0) + 1);
  }

  return controls
    .map((control) => {
      const type = types.get(control.type);
      return {
        id: control.id,
        name: control.name,
        typeId: control.type,
        typeTitle: type?.title ?? control.type,
        icon: type?.icon ?? 'Puzzle',
        available: !!type,
        uses: uses.get(control.id) ?? 0,
      };
    })
    .sort(compareRows);
}

export function searchExistingControls(
  rows: readonly ExistingControlRow[],
  query: string,
): ExistingControlRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...rows];
  }
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      row.typeId.toLowerCase().includes(needle) ||
      row.typeTitle.toLowerCase().includes(needle),
  );
}

export type Item = { id: string; control: string; x: number; y: number; w: number; h: number };
export type Grid = { rows: number; cols: number };
export type DeckSizing = 'auto' | 'manual';
export type FittedDeck = { cell: number; gap: number; width: number; height: number };
/** What the layout editor has selected: a widget, an empty cell, or nothing. */
export type Selection = { item: string } | { cell: { x: number; y: number } } | null;
export type Rect = Pick<Item, 'x' | 'y' | 'w' | 'h'>;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const inside = (r: Rect, g: Grid) =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= g.cols && r.y + r.h <= g.rows;

/**
 * Corner radius of a tile on cells of `cell` px: 22 px from 110 px cells up, a fifth of the cell below, so small
 * tiles keep rounded squares instead of turning into circles.
 */
export const tileRadius = (cell: number) => Math.min(22, cell / 5);

/** Fit square cells inside a usable host without changing the persisted grid geometry. */
export function fitDeck(
  deck: { rows: number; cols: number; size: number; gap: number; sizing: DeckSizing },
  availableWidth: number,
  availableHeight: number,
): FittedDeck | null {
  const { rows, cols } = deck;
  if (
    !Number.isInteger(rows) ||
    rows <= 0 ||
    !Number.isInteger(cols) ||
    cols <= 0 ||
    !Number.isFinite(availableWidth) ||
    availableWidth <= 0 ||
    !Number.isFinite(availableHeight) ||
    availableHeight <= 0
  )
    return null;

  const size = Number.isFinite(deck.size) && deck.size > 0 ? deck.size : 112;
  const gap = Number.isFinite(deck.gap) ? deck.gap : 14;
  const g = Math.min(
    Math.max(0, gap),
    availableWidth / (2 * (cols + 1)),
    availableHeight / (2 * (rows + 1)),
  );
  const fitCell = Math.min(
    (availableWidth - (cols + 1) * g) / cols,
    (availableHeight - (rows + 1) * g) / rows,
  );
  const cell = deck.sizing === 'manual' ? Math.min(size, fitCell) : fitCell;
  return {
    cell,
    gap: g,
    width: cols * cell + (cols + 1) * g,
    height: rows * cell + (rows + 1) * g,
  };
}

/** Does `rect` fit without overlapping anything except the items listed in `ignore`? */
export function fits(items: Item[], rect: Rect, grid: Grid, ignore: string[] = []) {
  return inside(rect, grid) && !items.some((i) => !ignore.includes(i.id) && overlaps(i, rect));
}

/** Largest obstacle-free rectangle inside `requested`, fixed at its opposite corner. */
export function clampResizeRect(
  requested: Rect,
  obstacles: readonly Rect[],
  corner: 'nw' | 'ne' | 'sw' | 'se',
  min: { w: number; h: number },
): Rect | null {
  if (
    ![requested.x, requested.y, requested.w, requested.h, min.w, min.h].every(Number.isFinite) ||
    requested.w <= 0 ||
    requested.h <= 0 ||
    min.w <= 0 ||
    min.h <= 0 ||
    requested.w < min.w ||
    requested.h < min.h
  )
    return null;

  const west = corner.includes('w'),
    north = corner.includes('n');
  const anchorX = west ? requested.x + requested.w : requested.x;
  const anchorY = north ? requested.y + requested.h : requested.y;
  const projected = obstacles.map((obstacle) => {
    if (
      ![obstacle.x, obstacle.y, obstacle.w, obstacle.h].every(Number.isFinite) ||
      obstacle.w <= 0 ||
      obstacle.h <= 0
    )
      return null;
    return {
      u0: west ? anchorX - obstacle.x - obstacle.w : obstacle.x - anchorX,
      u1: west ? anchorX - obstacle.x : obstacle.x + obstacle.w - anchorX,
      v0: north ? anchorY - obstacle.y - obstacle.h : obstacle.y - anchorY,
      v1: north ? anchorY - obstacle.y : obstacle.y + obstacle.h - anchorY,
    };
  });
  if (projected.some((rect) => rect == null)) return null;

  const candidates = new Set([requested.w]);
  for (const rect of projected)
    if (rect && rect.u0 >= min.w && rect.u0 <= requested.w) candidates.add(rect.u0);
  let best: Rect | null = null;
  let bestArea = -Infinity;
  for (const w of candidates) {
    let h = requested.h;
    for (const rect of projected) {
      if (rect && rect.u1 > 0 && rect.v1 > 0 && rect.u0 < w) h = Math.min(h, rect.v0);
    }
    if (h < min.h) continue;
    const area = w * h;
    if (area < bestArea || (area === bestArea && best && w < best.w)) continue;
    bestArea = area;
    best = { x: west ? anchorX - w : anchorX, y: north ? anchorY - h : anchorY, w, h };
  }
  return best;
}

/** First free spot for a w×h widget, scanning row by row. */
export function firstFree(items: Item[], w: number, h: number, grid: Grid) {
  for (let y = 0; y + h <= grid.rows; y++)
    for (let x = 0; x + w <= grid.cols; x++) if (fits(items, { x, y, w, h }, grid)) return { x, y };
  return null;
}

export type DropPreview =
  | { kind: 'move' | 'swap'; items: Item[]; displaced: string[] }
  | { kind: 'invalid'; reason: 'bounds' | 'occupied' | 'missing' | 'layout' };

const validGrid = (grid: Grid) =>
  Number.isInteger(grid.rows) && grid.rows > 0 && Number.isInteger(grid.cols) && grid.cols > 0;
const layoutIsValid = (items: Item[], grid: Grid) =>
  validGrid(grid) &&
  items.every(
    (i) =>
      typeof i.id === 'string' &&
      !!i.id &&
      typeof i.control === 'string' &&
      Number.isInteger(i.x) &&
      Number.isInteger(i.y) &&
      Number.isInteger(i.w) &&
      i.w > 0 &&
      Number.isInteger(i.h) &&
      i.h > 0 &&
      inside(i, grid),
  ) &&
  new Set(items.map((i) => i.id)).size === items.length &&
  items.every((a, n) => items.slice(n + 1).every((b) => !overlaps(a, b)));

const maskOf = (rect: Rect, cols: number) => {
  let mask = 0n;
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) mask |= 1n << BigInt(y * cols + x);
  return mask;
};
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const area = (item: Rect) => item.w * item.h;
const order = (a: Reinsert, b: Reinsert) =>
  area(b.item) - area(a.item) ||
  Math.max(b.item.w, b.item.h) - Math.max(a.item.w, a.item.h) ||
  a.item.y - b.item.y ||
  a.item.x - b.item.x ||
  compareId(a.item.id, b.item.id);
type Reinsert = {
  item: Item;
  candidates: { x: number; y: number; mask: bigint }[];
};

/** Exact deterministic relocation for all direct blockers, without moving unrelated items. */
export function previewDrop(
  items: Item[],
  id: string,
  x: number,
  y: number,
  grid: Grid,
): DropPreview {
  if (!layoutIsValid(items, grid)) return { kind: 'invalid', reason: 'layout' };
  const moving = items.find((i) => i.id === id);
  if (!moving) return { kind: 'invalid', reason: 'missing' };
  const target = { x, y, w: moving.w, h: moving.h };
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inside(target, grid))
    return { kind: 'invalid', reason: 'bounds' };
  const blockers = items.filter((i) => i.id !== id && overlaps(i, target));
  const moved = { ...moving, x, y };
  if (!blockers.length) {
    return { kind: 'move', items: items.map((i) => (i.id === id ? moved : i)), displaced: [] };
  }

  const blockedIds = new Set(blockers.map((i) => i.id));
  const stationary = items.filter((i) => i.id !== id && !blockedIds.has(i.id));
  let occupied = maskOf(moved, grid.cols);
  let free = grid.cols * grid.rows - area(moved);
  for (const item of stationary) {
    occupied |= maskOf(item, grid.cols);
    free -= area(item);
  }
  const relocations: Reinsert[] = blockers.map((item) => {
    const candidates = [];
    for (let cy = 0; cy + item.h <= grid.rows; cy++)
      for (let cx = 0; cx + item.w <= grid.cols; cx++) {
        const inSource =
          cx >= moving.x &&
          cy >= moving.y &&
          cx + item.w <= moving.x + moving.w &&
          cy + item.h <= moving.y + moving.h;
        candidates.push({
          x: cx,
          y: cy,
          mask: maskOf({ x: cx, y: cy, w: item.w, h: item.h }, grid.cols),
          inSource,
          distance: Math.abs(cx - item.x) + Math.abs(cy - item.y),
        });
      }
    candidates.sort(
      (a, b) =>
        Number(b.inSource) - Number(a.inSource) ||
        a.distance - b.distance ||
        a.y - b.y ||
        a.x - b.x,
    );
    return { item, candidates };
  });
  const failed = new Set<string>();
  const chosen = new Map<string, { x: number; y: number }>();

  function search(remaining: Reinsert[], mask: bigint, free: number): boolean {
    if (!remaining.length) return true;
    if (remaining.reduce((sum, entry) => sum + area(entry.item), 0) > free) return false;
    const memoKey =
      JSON.stringify(remaining.map((entry) => entry.item.id).sort(compareId)) +
      ':' +
      mask.toString(36);
    if (failed.has(memoKey)) return false;

    let selected: Reinsert | undefined;
    let legal: Reinsert['candidates'] = [];
    for (const entry of remaining) {
      const available = entry.candidates.filter((candidate) => (candidate.mask & mask) === 0n);
      if (!available.length) {
        failed.add(memoKey);
        return false;
      }
      if (
        !selected ||
        available.length < legal.length ||
        (available.length === legal.length && order(entry, selected) < 0)
      ) {
        selected = entry;
        legal = available;
      }
    }
    const rest = remaining.filter((entry) => entry !== selected);
    for (const candidate of legal) {
      chosen.set(selected!.item.id, { x: candidate.x, y: candidate.y });
      if (search(rest, mask | candidate.mask, free - area(selected!.item))) return true;
    }
    failed.add(memoKey);
    return false;
  }

  if (!search(relocations, occupied, free)) return { kind: 'invalid', reason: 'occupied' };
  const next = items.map((item) =>
    item.id === id ? moved : chosen.has(item.id) ? { ...item, ...chosen.get(item.id)! } : item,
  );
  return {
    kind: 'swap',
    items: next,
    displaced: [...blockers]
      .sort((a, b) => a.y - b.y || a.x - b.x || compareId(a.id, b.id))
      .map((item) => item.id),
  };
}

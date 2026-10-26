import { describe, expect, it } from 'vitest';
import { clampResizeRect, drop, firstFree, fits, fitDeck, placementForType, previewDrop, type Item } from './grid';

const grid = { rows: 3, cols: 4 };
const items: Item[] = [
  { id: 'a', control: 'prev', x: 0, y: 0, w: 1, h: 1 },
  { id: 'b', control: 'next', x: 1, y: 0, w: 1, h: 1 },
  { id: 'm', control: 'mixer', x: 0, y: 1, w: 2, h: 2 },
];

describe('deck layout', () => {
  it('fits square auto cells and treats manual size as a preferred maximum', () => {
    const base = { rows: 3, cols: 6, size: 112, gap: 14, sizing: 'auto' as const };
    expect(fitDeck(base, 600, 300)).toEqual({ cell: 244 / 3, gap: 14, width: 586, height: 300 });
    expect(fitDeck(base, 1000, 300)).toMatchObject({ cell: 244 / 3, width: 586, height: 300 });
    expect(fitDeck(base, 770, 392)).toEqual({ cell: 112, gap: 14, width: 770, height: 392 });
    expect(fitDeck({ ...base, sizing: 'manual' }, 1540, 784)).toEqual({ cell: 112, gap: 14, width: 770, height: 392 });
    expect(fitDeck(base, 1540, 784)?.cell).toBeCloseTo(1442 / 6);
  });

  it('keeps usable hosts inside bounds and rejects invalid or hidden hosts', () => {
    expect(fitDeck({ rows: 1, cols: 1, size: 10.5, gap: 0, sizing: 'manual' }, 100, 100))
      .toEqual({ cell: 10.5, gap: 0, width: 10.5, height: 10.5 });
    expect(fitDeck({ rows: 1, cols: 1, size: 100, gap: 1000, sizing: 'auto' }, 1, 1))
      .toEqual({ cell: 0.5, gap: 0.25, width: 1, height: 1 });
    expect(fitDeck({ rows: 1, cols: 1, size: NaN, gap: Infinity, sizing: 'auto' }, 100, 100))
      .toEqual({ cell: 72, gap: 14, width: 100, height: 100 });
    for (const [width, height] of [[0, 100], [-1, 100], [Infinity, 100], [100, NaN]])
      expect(fitDeck({ rows: 3, cols: 6, size: 112, gap: 14, sizing: 'auto' }, width, height)).toBeNull();
    expect(fitDeck({ rows: 0, cols: 6, size: 112, gap: 14, sizing: 'auto' }, 600, 300)).toBeNull();
    expect(fitDeck({ rows: 2.5, cols: 6, size: 112, gap: 14, sizing: 'auto' }, 600, 300)).toBeNull();
  });

  it('does not overflow across fractional sizes, zero gaps and extreme gaps', () => {
    for (const rows of [1, 2, 5]) for (const cols of [1, 3, 7])
      for (const [width, height] of [[0.01, 0.02], [80.5, 39.25], [1000, 300]])
        for (const gap of [0, 8.25, 1e8]) {
          const fit = fitDeck({ rows, cols, size: 33.3, gap, sizing: 'auto' }, width, height)!;
          expect(fit.cell).toBeGreaterThan(0);
          expect(fit.width).toBeLessThanOrEqual(width + 0.01);
          expect(fit.height).toBeLessThanOrEqual(height + 0.01);
        }
  });

  it('checks bounds and overlaps', () => {
    expect(fits(items, { x: 2, y: 0, w: 2, h: 2 }, grid)).toBe(true);
    expect(fits(items, { x: 1, y: 1, w: 2, h: 1 }, grid)).toBe(false);
    expect(fits(items, { x: 3, y: 0, w: 2, h: 1 }, grid)).toBe(false);
    expect(fits(items, { x: 0, y: 1, w: 2, h: 2 }, grid, ['m'])).toBe(true);
  });

  it('finds the first free spot for a widget size', () => {
    expect(firstFree(items, 1, 1, grid)).toEqual({ x: 2, y: 0 });
    expect(firstFree(items, 2, 3, grid)).toEqual({ x: 2, y: 0 });
    expect(firstFree(items, 3, 1, grid)).toBeNull();
  });

  it('fits type presets by minimum size and prefers the largest fitting footprint', () => {
    const slider = { size: { w: 1, h: 3 } };
    expect(placementForType([], { rows: 3, cols: 3 }, slider, { x: 2, y: 2 })).toEqual({ x: 2, y: 2, w: 1, h: 1 });
    expect(placementForType([], { rows: 3, cols: 3 }, slider, { x: 1, y: 1 })).toEqual({ x: 1, y: 1, w: 1, h: 2 });
    expect(placementForType([], { rows: 3, cols: 3 }, slider, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, w: 1, h: 3 });
    expect(placementForType([], { rows: 1, cols: 1 }, { size: { w: 4, h: 3 }, minSize: { w: 2, h: 2 } })).toBeNull();
    expect(placementForType([], { rows: 3, cols: 4 }, { size: { w: 3, h: 2 }, minSize: { w: 1, h: 1 } }, { x: 3, y: 2 }))
      .toEqual({ x: 3, y: 2, w: 1, h: 1 });
  });

  it('ranks by area then width, keeps a preferred smaller fit ahead of a distant default, and respects max size', () => {
    const items = [{ id: 'block', control: 'b', x: 0, y: 0, w: 2, h: 2 }];
    expect(placementForType(items, { rows: 4, cols: 4 }, { size: { w: 3, h: 2 }, minSize: { w: 1, h: 1 } }, { x: 0, y: 0 }))
      .toEqual({ x: 0, y: 2, w: 3, h: 2 });
    const preferredObstacle = [{ id: 'block', control: 'b', x: 1, y: 0, w: 3, h: 2 }];
    expect(placementForType(preferredObstacle, { rows: 4, cols: 4 }, { size: { w: 3, h: 2 }, minSize: { w: 1, h: 1 } }, { x: 0, y: 0 }))
      .toEqual({ x: 0, y: 0, w: 1, h: 2 });
    expect(placementForType([], { rows: 4, cols: 4 }, { size: { w: 4, h: 4 }, minSize: { w: 1, h: 1 }, maxSize: { w: 2, h: 3 } }))
      .toEqual({ x: 0, y: 0, w: 2, h: 3 });
    for (const limits of [
      { size: { w: 0, h: 2 } }, { size: { w: 2.5, h: 2 } },
      { size: { w: 2, h: 2 }, minSize: { w: 3, h: 1 } },
    ]) expect(placementForType([], { rows: 4, cols: 4 }, limits)).toBeNull();
    expect(placementForType([], { rows: 4, cols: 4 }, { size: { w: 2, h: 2 }, maxSize: { w: 1, h: 2 } }))
      .toEqual({ x: 0, y: 0, w: 1, h: 2 });
  });

  it('moves into free space, swaps equal-size items, refuses overlaps', () => {
    expect(drop(items, 'a', 3, 2, grid)!.find(i => i.id === 'a')).toMatchObject({ x: 3, y: 2 });
    const swapped = drop(items, 'a', 1, 0, grid)!;
    expect(swapped.find(i => i.id === 'a')).toMatchObject({ x: 1, y: 0 });
    expect(swapped.find(i => i.id === 'b')).toMatchObject({ x: 0, y: 0 });
    const relocatedMixer = drop(items, 'a', 1, 1, grid)!;
    expect(relocatedMixer.find(i => i.id === 'm')).toMatchObject({ x: 2, y: 1 });
    expect(drop(items, 'm', 3, 1, grid)).toBeNull(); // off the grid
  });

  it('swaps a smaller tile into the source footprint when the snapped result is collision-free', () => {
    const board: Item[] = [
      { id: 'large', control: 'mixer', x: 0, y: 0, w: 2, h: 2 },
      { id: 'small', control: 'slider', x: 2, y: 0, w: 1, h: 2 },
      { id: 'still', control: 'button', x: 4, y: 0, w: 1, h: 1 },
    ];
    const result = previewDrop(board, 'large', 2, 0, { rows: 3, cols: 5 });
    expect(result).toMatchObject({ kind: 'swap', displaced: ['small'] });
    if (result.kind !== 'invalid') {
      expect(result.items).toEqual([
        { ...board[0], x: 2, y: 0 }, { ...board[1], x: 1, y: 0 }, board[2],
      ]);
      expect(result.items.map(i => i.id)).toEqual(board.map(i => i.id));
      expect(result.items.slice(0, 2)[0]).toMatchObject({ w: 2, h: 2 });
      expect(result.items.slice(0, 2)[1]).toMatchObject({ w: 1, h: 2 });
    }
  });

  it('allows self-overlap and searches past source candidates blocked by the moving target', () => {
    const selfOverlap = previewDrop(items, 'm', 1, 1, grid);
    expect(selfOverlap).toMatchObject({ kind: 'move' });

    const board: Item[] = [
      { id: 'large', control: 'mixer', x: 2, y: 2, w: 3, h: 3 },
      { id: 'small', control: 'button', x: 1, y: 1, w: 1, h: 1 },
    ];
    const result = previewDrop(board, 'large', 1, 1, { rows: 6, cols: 6 });
    expect(result).toMatchObject({ kind: 'swap', displaced: ['small'] });
    if (result.kind !== 'invalid') expect(result.items[1]).toMatchObject({ x: 4, y: 2 });
  });

  it('repositions larger and multiple blockers while preserving sizes and stationary items', () => {
    const larger: Item[] = [
      { id: 'small', control: 'button', x: 0, y: 0, w: 1, h: 1 },
      { id: 'large', control: 'mixer', x: 1, y: 0, w: 1, h: 2 },
      { id: 'lower', control: 'button', x: 0, y: 1, w: 1, h: 1 },
    ];
    expect(previewDrop(larger, 'small', 1, 0, { rows: 2, cols: 4 })).toMatchObject({ kind: 'swap', displaced: ['large'] });
    expect(previewDrop(larger, 'large', 0, 0, { rows: 2, cols: 4 })).toMatchObject({ kind: 'swap', displaced: ['small', 'lower'] });
    const blocked: Item[] = [
      { id: 'moving', control: 'mixer', x: 0, y: 0, w: 1, h: 1 },
      { id: 'one', control: 'button', x: 1, y: 0, w: 2, h: 1 },
    ];
    expect(previewDrop(blocked, 'moving', 1, 0, { rows: 1, cols: 3 })).toMatchObject({ kind: 'invalid', reason: 'occupied' });
    expect(previewDrop(items, 'a', -1, 0, grid)).toMatchObject({ kind: 'invalid', reason: 'bounds' });
    expect(previewDrop(items, 'missing', 0, 0, grid)).toMatchObject({ kind: 'invalid', reason: 'missing' });
  });

  it('solves a full two-row displacement into the vacated source deterministically', () => {
    const board: Item[] = [
      { id: 'a', control: 'mixer', x: 0, y: 0, w: 2, h: 2 },
      { id: 'b', control: 'slider', x: 2, y: 0, w: 1, h: 2 },
      { id: 'c', control: 'slider', x: 3, y: 0, w: 1, h: 2 },
    ];
    const result = previewDrop(board, 'a', 2, 0, { rows: 2, cols: 4 });
    expect(result).toMatchObject({ kind: 'swap', displaced: ['b', 'c'] });
    if (result.kind !== 'invalid') expect(result.items.map(i => [i.id, i.x, i.y])).toEqual([['a', 2, 0], ['b', 1, 0], ['c', 0, 0]]);
    const reversed = previewDrop([...board].reverse(), 'a', 2, 0, { rows: 2, cols: 4 });
    if (result.kind !== 'invalid' && reversed.kind !== 'invalid')
      expect(Object.fromEntries(result.items.map(i => [i.id, [i.x, i.y]]))).toEqual(Object.fromEntries(reversed.items.map(i => [i.id, [i.x, i.y]])));
  });

  it('rejects malformed layouts instead of silently rearranging them', () => {
    expect(previewDrop([{ ...items[0], x: Number.NaN }], 'a', 0, 0, grid)).toMatchObject({ kind: 'invalid', reason: 'layout' });
    expect(previewDrop([{ ...items[0], w: 0 }], 'a', 0, 0, grid)).toMatchObject({ kind: 'invalid', reason: 'layout' });
    expect(previewDrop([items[0], { ...items[0], id: 'a' }], 'a', 0, 0, grid)).toMatchObject({ kind: 'invalid', reason: 'layout' });
    expect(previewDrop([items[0], { ...items[0], id: 'x', x: 0, y: 0 }], 'a', 0, 0, grid)).toMatchObject({ kind: 'invalid', reason: 'layout' });
  });

  it('matches a seeded exhaustive feasibility oracle on small valid boards', () => {
    let seed = 0x51f15e;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    const oracle = (board: Item[], moverId: string, x: number, y: number, g: { rows: number; cols: number }) => {
      const mover = board.find(i => i.id === moverId)!;
      const target = { ...mover, x, y };
      const blockers = board.filter(i => i.id !== moverId && i.x < x + mover.w && x < i.x + i.w && i.y < y + mover.h && y < i.y + i.h);
      const occupied = board.filter(i => i.id !== moverId && !blockers.includes(i)).map(i => ({ ...i }));
      occupied.push(target);
      const visit = (at: number): boolean => {
        if (at === blockers.length) return true;
        const block = blockers[at];
        for (let cy = 0; cy + block.h <= g.rows; cy++) for (let cx = 0; cx + block.w <= g.cols; cx++) {
          if (occupied.some(i => i.x < cx + block.w && cx < i.x + i.w && i.y < cy + block.h && cy < i.y + i.h)) continue;
          occupied.push({ ...block, x: cx, y: cy });
          if (visit(at + 1)) return true;
          occupied.pop();
        }
        return false;
      };
      return visit(0);
    };
    let cases = 0;
    for (let run = 0; run < 120; run++) {
      const g = { rows: 3 + Math.floor(random() * 2), cols: 3 + Math.floor(random() * 2) };
      const board: Item[] = [];
      for (let n = 0; n < 5; n++) {
        const w = 1 + Math.floor(random() * Math.min(2, g.cols)), h = 1 + Math.floor(random() * Math.min(2, g.rows));
        const x = Math.floor(random() * (g.cols - w + 1)), y = Math.floor(random() * (g.rows - h + 1));
        if (fits(board, { x, y, w, h }, g)) board.push({ id: String(n), control: 'button', x, y, w, h });
      }
      if (board.length < 2) continue;
      const mover = board[Math.floor(random() * board.length)];
      const x = Math.floor(random() * g.cols), y = Math.floor(random() * g.rows);
      const expected = x + mover.w <= g.cols && y + mover.h <= g.rows && oracle(board, mover.id, x, y, g);
      const actual = previewDrop(board, mover.id, x, y, g);
      expect(actual.kind !== 'invalid').toBe(expected);
      cases++;
    }
    expect(cases).toBeGreaterThan(100);
  });

  it('keeps the input and item order unchanged and never returns overlaps', () => {
    const source = structuredClone(items);
    const results = [previewDrop(items, 'a', 3, 2, grid), previewDrop(items, 'a', 1, 0, grid)];
    expect(items).toEqual(source);
    for (const result of results) if (result.kind !== 'invalid') {
      expect(result.items.map(i => i.id)).toEqual(items.map(i => i.id));
      for (let i = 0; i < result.items.length; i++)
        for (let j = i + 1; j < result.items.length; j++)
          expect(fits([result.items[i]], result.items[j], grid)).toBe(true);
    }
  });

  it('maximizes an anchored resize against contacts, multiple blockers, and minimum bounds', () => {
    const corners = ['nw', 'ne', 'sw', 'se'] as const;
    for (const corner of corners) {
      const requested = { x: 10, y: 10, w: 6, h: 5 };
      const anchorX = corner.includes('w') ? 16 : 10, anchorY = corner.includes('n') ? 15 : 10;
      const obstacle = { x: corner.includes('w') ? anchorX - 3 : anchorX + 2,
        y: corner.includes('n') ? anchorY - 2 : anchorY + 1, w: 1, h: 1 };
      expect(clampResizeRect(requested, [obstacle], corner, { w: 1, h: 1 })).toEqual({
        x: corner.includes('w') ? anchorX - 2 : anchorX,
        y: corner.includes('n') ? anchorY - 5 : anchorY, w: 2, h: 5,
      });
    }

    const request = { x: 0, y: 0, w: 8, h: 8 };
    const blockers = [{ x: 3, y: 5, w: 1, h: 1 }, { x: 6, y: 2, w: 1, h: 1 }];
    const result = clampResizeRect(request, blockers, 'se', { w: 1, h: 1 });
    expect(result).toEqual({ x: 0, y: 0, w: 6, h: 5 });
    expect(clampResizeRect(request, [...blockers].reverse(), 'se', { w: 1, h: 1 })).toEqual(result);
    expect(clampResizeRect(request, [{ x: 5.5, y: 2, w: 1, h: 1 }], 'se', { w: 1, h: 1 }))
      .toEqual({ x: 0, y: 0, w: 5.5, h: 8 });
    expect(clampResizeRect({ x: 0, y: 0, w: 6, h: 5 }, [{ x: 1, y: 1, w: 1, h: 1 }], 'se', { w: 3, h: 2 })).toBeNull();
    expect(clampResizeRect({ x: 0, y: 0, w: 6, h: 5 }, [{ x: -2, y: 0, w: 1, h: 3 }, { x: 0, y: -2, w: 4, h: 1 }], 'se', { w: 1, h: 1 }))
      .toEqual({ x: 0, y: 0, w: 6, h: 5 });
    expect(clampResizeRect(request, [], 'se', { w: 9, h: 1 })).toBeNull();
  });

  it('matches a seeded exhaustive anchored-rectangle oracle on 500 small boards', () => {
    let seed = 0x4ca9_2026;
    const random = () => ((seed = (seed * 1_664_525 + 1_013_904_223) >>> 0) / 0x1_0000_0000);
    const corners = ['nw', 'ne', 'sw', 'se'] as const;
    const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (let test = 0; test < 500; test++) {
      const corner = corners[Math.floor(random() * corners.length)];
      const requested = { x: 2, y: 2, w: 1 + Math.floor(random() * 5), h: 1 + Math.floor(random() * 5) };
      const min = { w: 1 + Math.floor(random() * requested.w), h: 1 + Math.floor(random() * requested.h) };
      const anchorX = corner.includes('w') ? requested.x + requested.w : requested.x;
      const anchorY = corner.includes('n') ? requested.y + requested.h : requested.y;
      const obstacles = Array.from({ length: Math.floor(random() * 6) }, () => ({
        x: Math.floor(anchorX - (corner.includes('w') ? random() * 9 : 0) + (corner.includes('w') ? 0 : random() * 9)),
        y: Math.floor(anchorY - (corner.includes('n') ? random() * 9 : 0) + (corner.includes('n') ? 0 : random() * 9)),
        w: 1 + Math.floor(random() * 3), h: 1 + Math.floor(random() * 3),
      }));
      let expected: typeof requested | null = null;
      for (let w = min.w; w <= requested.w; w++) for (let h = min.h; h <= requested.h; h++) {
        const rect = { x: corner.includes('w') ? anchorX - w : anchorX,
          y: corner.includes('n') ? anchorY - h : anchorY, w, h };
        if (obstacles.some(obstacle => overlaps(rect, obstacle))) continue;
        if (!expected || w * h > expected.w * expected.h ||
          (w * h === expected.w * expected.h && (w > expected.w || (w === expected.w && h > expected.h)))) expected = rect;
      }
      expect(clampResizeRect(requested, obstacles, corner, min), `seed 0x4ca92026 case ${test}`).toEqual(expected);
    }
  });
});

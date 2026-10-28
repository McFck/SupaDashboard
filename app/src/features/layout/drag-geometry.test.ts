import { describe, expect, it } from 'vitest';
import { projectMoveOrigin, resizeFromCornerHysteretic, type ResizeCorner } from './drag-geometry';

describe('corner resizing', () => {
  const rect = { x: 3, y: 3, w: 3, h: 3 };
  it.each(['nw', 'ne', 'sw', 'se'] as ResizeCorner[])(
    '%s keeps the opposite anchor fixed with snap hysteresis',
    (corner) => {
      const west = corner.includes('w'),
        north = corner.includes('n');
      const anchor = { x: rect.x + (west ? rect.w : 0), y: rect.y + (north ? rect.h : 0) };
      const moved = resizeFromCornerHysteretic(
        rect,
        corner,
        west ? -67 : 67,
        north ? -67 : 67,
        126,
      );
      expect(moved).toMatchObject({ w: 4, h: 4 });
      expect(moved.x + (west ? moved.w : 0)).toBe(anchor.x);
      expect(moved.y + (north ? moved.h : 0)).toBe(anchor.y);
      expect(
        resizeFromCornerHysteretic(rect, corner, west ? -62 : 62, north ? -62 : 62, 126, moved),
      ).toEqual(moved);
      const reversed = resizeFromCornerHysteretic(
        rect,
        corner,
        west ? -58 : 58,
        north ? -58 : 58,
        126,
        moved,
      );
      expect(reversed).toEqual(rect);
    },
  );
});

describe('move origin projection', () => {
  const geometry = { gridLeft: 100, gridTop: 50, scale: 1.25, pitch: 126.5, gap: 14.25 };
  it('keeps the grabbed point attached and snaps by tile origin regardless of grab position', () => {
    const source = { x: 2, y: 1 },
      origin = {
        x: source.x * geometry.pitch + geometry.gap,
        y: source.y * geometry.pitch + geometry.gap,
      };
    const pointerOffsets = [
      { x: 0, y: 0 },
      { x: 40.5, y: 62.25 },
      { x: 126.4, y: 20 },
    ];
    const projections = pointerOffsets.map((offset) =>
      projectMoveOrigin(
        geometry.gridLeft + (origin.x + offset.x) * geometry.scale + 37.5,
        geometry.gridTop + (origin.y + offset.y) * geometry.scale - 18.75,
        geometry,
        { x: offset.x, y: offset.y },
        source,
      ),
    );
    for (const result of projections)
      expect(result).toMatchObject({ x: 2, y: 1, translateX: 30, translateY: -15 });
    const moved = pointerOffsets.map((offset) =>
      projectMoveOrigin(
        geometry.gridLeft + (origin.x + offset.x + geometry.pitch * 0.6) * geometry.scale,
        geometry.gridTop + (origin.y + offset.y) * geometry.scale,
        geometry,
        { x: offset.x, y: offset.y },
        source,
      ),
    );
    expect(moved.map((p) => p.x)).toEqual([3, 3, 3]);
  });
});

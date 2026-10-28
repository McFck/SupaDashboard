import { describe, expect, it } from 'vitest';
import {
  projectMoveOrigin,
  resizeFromCornerHysteretic,
  resizePreview,
  type ResizeCorner,
} from './drag-geometry';

describe('corner resizing', () => {
  const rect = { x: 3, y: 3, w: 3, h: 3 };
  it('keeps live previews continuous below the cell snap threshold, with opposite-corner anchoring', () => {
    const preview = resizePreview(rect, 'se', 20, -30, 126, 14);
    expect(preview.width).toBe(384);
    expect(preview.height).toBe(334);
    expect(preview.x).toBe(0);
    const northwest = resizePreview(rect, 'nw', 20, -30, 126, 14);
    expect(northwest).toMatchObject({ x: 20, y: -30, width: 344, height: 394 });
    expect(northwest.x + northwest.width).toBe(364);
    expect(northwest.y + northwest.height).toBe(364);
    expect(resizePreview(rect, 'se', -1000, -1000, 126, 14, { w: 2, h: 1 })).toMatchObject({
      width: 238,
      height: 112,
    });
  });
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
  it.each(['nw', 'ne', 'sw', 'se'] as ResizeCorner[])(
    '%s produces unscaled frame bounds with the opposite corner anchored',
    (corner) => {
      const west = corner.includes('w'),
        north = corner.includes('n');
      const frame = resizePreview(
        rect,
        corner,
        west ? 20 : -20,
        north ? 30 : -30,
        126,
        14,
        { w: 2, h: 2 },
        { w: 4, h: 4 },
      );
      expect(frame.width).toBe(344);
      expect(frame.height).toBe(334);
      expect(frame.x + (west ? frame.width : 0)).toBe(west ? 364 : 0);
      expect(frame.y + (north ? frame.height : 0)).toBe(north ? 364 : 0);
      expect(
        resizePreview(
          rect,
          corner,
          west ? -1000 : 1000,
          north ? -1000 : 1000,
          126,
          14,
          { w: 2, h: 2 },
          { w: 4, h: 4 },
        ),
      ).toMatchObject({ width: 490, height: 490 });
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
  it('uses Math.round half ties on either side, including negative candidate coordinates', () => {
    const at = (originX: number) =>
      projectMoveOrigin(
        100 + originX,
        50,
        { ...geometry, scale: 1 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ).x;
    expect(at(geometry.gap + geometry.pitch * 0.5 - 0.01)).toBe(0);
    expect(at(geometry.gap + geometry.pitch * 0.5)).toBe(1);
    expect(at(geometry.gap + geometry.pitch * -0.5 + 0.01)).toBe(0);
    expect(at(geometry.gap + geometry.pitch * -0.5)).toBe(0);
    expect(at(geometry.gap + geometry.pitch * -0.5 - 0.01)).toBe(-1);
  });
});

// Pixel geometry for moving and resizing placements on the grid.
export type Box = { x: number; y: number; width: number; height: number };
type CellRect = { x: number; y: number; w: number; h: number };
type CellSize = { w: number; h: number };

/** Pixel box of a placement: cells are `pitch` apart and the grid is inset by one gap. */
export function itemBox(item: CellRect, pitch: number, gap: number): Box {
  return {
    x: item.x * pitch + gap,
    y: item.y * pitch + gap,
    width: item.w * pitch - gap,
    height: item.h * pitch - gap,
  };
}

/** Size limits for a corner resize: the type's own limits, capped by the grid edges that corner grows toward. */
export function resizeLimits(
  item: CellRect,
  corner: ResizeCorner,
  grid: { rows: number; cols: number },
  size: { min?: CellSize; max?: CellSize },
) {
  const min = size.min ?? { w: 1, h: 1 };
  const registeredMax = size.max ?? { w: 99, h: 99 };
  const max = {
    w: Math.min(registeredMax.w, corner.includes('w') ? item.x + item.w : grid.cols - item.x),
    h: Math.min(registeredMax.h, corner.includes('n') ? item.y + item.h : grid.rows - item.y),
  };
  return { min, max };
}

/** One cell per arrow key; Shift grows or shrinks both axes together. */
export function keyboardResizeDelta(key: string, shiftKey: boolean, pitch: number) {
  let dx = key === 'ArrowLeft' ? -pitch : key === 'ArrowRight' ? pitch : 0;
  let dy = key === 'ArrowUp' ? -pitch : key === 'ArrowDown' ? pitch : 0;
  if (!dx && !dy) {
    return null;
  }
  if (shiftKey) {
    if (dx !== 0) {
      dy = dx;
    } else {
      dx = dy;
    }
  }
  return { dx, dy };
}

/** Project a captured logical-pixel grab point to the tile's nearest grid-origin snap. */
export function projectMoveOrigin(
  clientX: number,
  clientY: number,
  geometry: { gridLeft: number; gridTop: number; scale: number; pitch: number; gap: number },
  grab: { x: number; y: number },
  source: { x: number; y: number },
) {
  const originX = (clientX - geometry.gridLeft) / geometry.scale - grab.x;
  const originY = (clientY - geometry.gridTop) / geometry.scale - grab.y;
  // Math.round sends exact negative half ties toward +infinity; both sides around the tie remain symmetric.
  const snap = (origin: number) => Math.round((origin - geometry.gap) / geometry.pitch) || 0;
  return {
    x: snap(originX),
    y: snap(originY),
    originX,
    originY,
    translateX: originX - (source.x * geometry.pitch + geometry.gap),
    translateY: originY - (source.y * geometry.pitch + geometry.gap),
  };
}

/** Continuous frame preview in pixels; only the eventual drop is snapped to cells. */
export function resizePreview(
  rect: { w: number; h: number },
  corner: ResizeCorner,
  dx: number,
  dy: number,
  pitch: number,
  gap: number,
  min = { w: 1, h: 1 },
  max = { w: 99, h: 99 },
) {
  const baseW = rect.w * pitch - gap,
    baseH = rect.h * pitch - gap;
  const west = corner.includes('w'),
    north = corner.includes('n');
  const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo * pitch - gap, Math.min(hi * pitch - gap, n));
  const width = clamp(baseW + dx * (west ? -1 : 1), min.w, max.w);
  const height = clamp(baseH + dy * (north ? -1 : 1), min.h, max.h);
  return { x: west ? baseW - width : 0, y: north ? baseH - height : 0, width, height };
}

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

/** Resize with a pixel deadband around each half-cell snap boundary. `previous` is the last snapped draft. */
export function resizeFromCornerHysteretic(
  rect: { x: number; y: number; w: number; h: number },
  corner: ResizeCorner,
  dx: number,
  dy: number,
  pitch: number,
  previous: { w: number; h: number } = rect,
  min = { w: 1, h: 1 },
  max = { w: 99, h: 99 },
  hysteresis = 4,
) {
  const west = corner.includes('w'),
    north = corner.includes('n');
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const snap = (delta: number, prior: number, low: number, high: number) => {
    if (!(pitch > 0) || !Number.isFinite(pitch) || !Number.isFinite(delta)) return prior;
    const deadband = Number.isFinite(hysteresis) ? Math.max(0, hysteresis) : 4;
    let cells = clamp(prior, low, high);
    while (cells < high && delta >= (cells + 0.5) * pitch + deadband) cells++;
    while (cells > low && delta <= (cells - 0.5) * pitch - deadband) cells--;
    return cells;
  };
  const xSign = west ? -1 : 1,
    ySign = north ? -1 : 1;
  const xBounds = [(min.w - rect.w) * xSign, (max.w - rect.w) * xSign].sort((a, b) => a - b);
  const yBounds = [(min.h - rect.h) * ySign, (max.h - rect.h) * ySign].sort((a, b) => a - b);
  const dw = snap(dx, (previous.w - rect.w) * xSign, xBounds[0], xBounds[1]);
  const dh = snap(dy, (previous.h - rect.h) * ySign, yBounds[0], yBounds[1]);
  const w = rect.w + dw * xSign;
  const h = rect.h + dh * ySign;
  return { x: west ? rect.x + rect.w - w : rect.x, y: north ? rect.y + rect.h - h : rect.y, w, h };
}

/** Handle hit boxes stay clickable beyond a tile edge while the visible corner mark stays outside it. */
export function resizeCornerGeometry(width: number, height: number, corner: ResizeCorner) {
  const hitSize = 28,
    hitOffset = 3,
    strokeSize = 12;
  const west = corner.includes('w'),
    north = corner.includes('n');
  const centerX = west ? -hitOffset : width + hitOffset;
  const centerY = north ? -hitOffset : height + hitOffset;
  return {
    hitSize,
    strokeSize,
    strokeGap: hitOffset,
    hitX: centerX - hitSize / 2,
    hitY: centerY - hitSize / 2,
    strokeX: west ? -hitOffset - strokeSize : width + hitOffset,
    strokeY: north ? -hitOffset - strokeSize : height + hitOffset,
  };
}

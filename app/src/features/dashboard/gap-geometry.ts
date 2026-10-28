// The drag gaps' geometry in CSS pixels relative to the dashboard shell: the free area left by excluded boxes.
export type LocalRect = { x: number; y: number; width: number; height: number };

export function complementRectangles(
  width: number,
  height: number,
  excluded: LocalRect[],
  dpr: number,
  inset = 6,
): LocalRect[] {
  if (
    ![width, height, dpr, inset].every(Number.isFinite) ||
    width <= inset * 2 ||
    height <= inset * 2 ||
    dpr <= 0 ||
    inset < 0
  ) {
    return [];
  }

  const left = inset,
    top = inset,
    right = width - inset,
    bottom = height - inset;
  const exclusions = excluded.flatMap((rect) => {
    if (
      ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return [];
    }
    const rawRight = rect.x + rect.width,
      rawBottom = rect.y + rect.height;
    if (!Number.isFinite(rawRight) || !Number.isFinite(rawBottom)) {
      return [];
    }
    const x = Math.max(left, Math.min(right, Math.floor(rect.x * dpr) / dpr));
    const y = Math.max(top, Math.min(bottom, Math.floor(rect.y * dpr) / dpr));
    const x2 = Math.max(left, Math.min(right, Math.ceil(rawRight * dpr) / dpr));
    const y2 = Math.max(top, Math.min(bottom, Math.ceil(rawBottom * dpr) / dpr));
    return x2 > x && y2 > y ? [{ x, y, right: x2, bottom: y2 }] : [];
  });
  const xs = [
    ...new Set([left, right, ...exclusions.flatMap((rect) => [rect.x, rect.right])]),
  ].sort((a, b) => a - b);
  const result: LocalRect[] = [];
  let previousBands = new Map<string, number>();

  for (let i = 0; i < xs.length - 1; i++) {
    const x = xs[i],
      x2 = xs[i + 1];
    if (x2 <= x) {
      continue;
    }
    const intervals = exclusions
      .filter((rect) => rect.x < x2 && rect.right > x)
      .map((rect) => ({ top: rect.y, bottom: rect.bottom }))
      .sort((a, b) => a.top - b.top || a.bottom - b.bottom);
    const gaps: Array<{ top: number; bottom: number }> = [];
    let cursor = top;
    for (const interval of intervals) {
      if (interval.top > cursor) {
        gaps.push({ top: cursor, bottom: interval.top });
      }
      cursor = Math.max(cursor, interval.bottom);
    }
    if (cursor < bottom) {
      gaps.push({ top: cursor, bottom });
    }

    const bands = new Map<string, number>();
    for (const gap of gaps) {
      if (gap.bottom <= gap.top) {
        continue;
      }
      const key = `${gap.top}:${gap.bottom}`;
      const previous = previousBands.get(key);
      if (previous !== undefined && result[previous].x + result[previous].width === x) {
        result[previous].width += x2 - x;
        bands.set(key, previous);
      } else {
        bands.set(
          key,
          result.push({ x, y: gap.top, width: x2 - x, height: gap.bottom - gap.top }) - 1,
        );
      }
    }
    previousBands = bands;
  }
  return result;
}

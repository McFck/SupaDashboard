// Pixel geometry for control faces.
/** Use the longer pixel dimension as the slider travel; square widgets prefer vertical. */
export function sliderOrientation(width: number, height: number): 'vertical' | 'horizontal' {
  return height >= width ? 'vertical' : 'horizontal';
}

/** Keep the button glyph proportional to the resolved footprint, including a live resize draft. */
export function buttonIconSize(width: number, height: number, compact = false) {
  return compact ? 20 : Math.min(38, Math.max(0, Math.min(width, height)) * .34);
}

/** Pointer-local ripple bounds corrected for a uniform scale around the tile center. */
export function pressRippleGeometry(width: number, height: number, clientX: number, clientY: number,
  rect: { left: number; top: number }, scale = 1) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const x = width / 2 + (clientX - rect.left - width / 2) / safeScale;
  const y = height / 2 + (clientY - rect.top - height / 2) / safeScale;
  const diameter = Math.max(1, 2 * Math.max(Math.hypot(x, y), Math.hypot(width - x, y),
    Math.hypot(x, height - y), Math.hypot(width - x, height - y)));
  return { x, y, diameter };
}

/** Compare the actual pill footprints after card padding and channel gaps. */
export function mixerLayout(width: number, height: number, channels: number, padding = 12, gap = 10): 'vertical' | 'horizontal' {
  const n = Math.max(1, channels);
  const w = Math.max(0, width - padding * 2), h = Math.max(0, height - padding * 2);
  const vw = Math.max(0, (w - gap * (n - 1)) / n), hh = Math.max(0, (h - gap * (n - 1)) / n);
  const verticalMin = Math.min(vw, h), horizontalMin = Math.min(w, hh);
  if (verticalMin !== horizontalMin) return verticalMin > horizontalMin ? 'vertical' : 'horizontal';
  if (vw * h !== w * hh) return vw * h > w * hh ? 'vertical' : 'horizontal';
  return h >= w ? 'vertical' : 'horizontal';
}

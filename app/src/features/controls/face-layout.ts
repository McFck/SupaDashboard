// Pixel thresholds that size control faces: slider and mixer orientation, icon size, and which texts fit.
/** Use the longer pixel dimension as the slider travel; square widgets prefer vertical. */
export function sliderOrientation(width: number, height: number): 'vertical' | 'horizontal' {
  return height >= width ? 'vertical' : 'horizontal';
}

/** Keep the button glyph proportional to the resolved footprint, including a live resize draft. */
export function buttonIconSize(
  width: number,
  height: number,
  compact = false,
  scale = 1,
  labelScale = 0,
) {
  if (compact) {
    return 20;
  }
  const edge = Math.max(0, Math.min(width, height));
  const base = Math.min(38, edge * 0.34);
  // The face pads 12px per side and puts an 8px gap and a 16px label line (scaled by labelScale) under the glyph; a
  // glyph grows into that room and shrinks when a large label line takes it. labelScale 0 means no label.
  const room = labelScale ? height - 24 - 8 - 16 * labelScale : edge * 0.6;
  return Math.max(0, Math.min(base * scale, room));
}

/** Compare the actual pill footprints after card padding and channel gaps. */
export function mixerLayout(
  width: number,
  height: number,
  channels: number,
  padding = 12,
  gap = 10,
): 'vertical' | 'horizontal' {
  const n = Math.max(1, channels);
  const w = Math.max(0, width - padding * 2),
    h = Math.max(0, height - padding * 2);
  const vw = Math.max(0, (w - gap * (n - 1)) / n),
    hh = Math.max(0, (h - gap * (n - 1)) / n);
  const verticalMin = Math.min(vw, h),
    horizontalMin = Math.min(w, hh);
  if (verticalMin !== horizontalMin) return verticalMin > horizontalMin ? 'vertical' : 'horizontal';
  if (vw * h !== w * hh) return vw * h > w * hh ? 'vertical' : 'horizontal';
  return h >= w ? 'vertical' : 'horizontal';
}

export type SliderFaceText = { name: boolean; percentage: boolean };

export function buttonLabelVisible(width: number, height: number) {
  return width >= 104 && height >= 88;
}

export function sliderFaceText(width: number, height: number, vertical: boolean): SliderFaceText {
  const thickness = vertical ? width : height;
  const length = vertical ? height : width;
  return {
    name: thickness >= (vertical ? 88 : 40) && length >= (vertical ? 140 : 176),
    percentage: thickness >= (vertical ? 56 : 32) && length >= (vertical ? 88 : 112),
  };
}

/**
 * Text-only faces run one line corner to corner. `ink` is the line's width per pixel of font size; the rotated line
 * box stays inside 80% of the face, so the rounded corners never cut its ends.
 */
export function diagonalLabel(width: number, height: number, ink: number) {
  const angle = Math.atan2(height, width);
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const fit = Math.min(
    (width * 0.8) / (ink * cos + sin),
    (height * 0.8) / (ink * sin + cos),
    Math.min(width, height) * 0.45,
  );
  return { degrees: (-angle * 180) / Math.PI, size: Math.max(9, fit) };
}

/** App-icon faces: a large badge that leaves the label line its room, like the button glyph. */
export function appBadgeSize(width: number, height: number, scale = 1, labelScale = 0) {
  const edge = Math.max(0, Math.min(width, height));
  const room = labelScale ? height - 24 - 8 - 16 * labelScale : edge - 24;
  return Math.max(0, Math.min(edge * 0.6 * scale, room));
}

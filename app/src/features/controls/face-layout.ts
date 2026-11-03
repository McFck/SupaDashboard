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

/** Line height of text-only faces, in ems. */
export const LINE_HEIGHT = 1.08;

/**
 * Text-only faces: the label's words, as widths per pixel of font size, wrap into balanced lines laid along the
 * tile's diagonal. Every line count is tried; the one whose rotated block fits 72% of the face at the largest size
 * wins, so short labels stay on one bold line and long ones stack. Words are never broken or truncated.
 */
export function diagonalText(width: number, height: number, words: number[], space: number) {
  const angle = Math.atan2(height, width);
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const span = (from: number, to: number) =>
    words.slice(from, to).reduce((sum, w) => sum + w, 0) + space * (to - from - 1);
  // widest[n][j]: the smallest widest line when the first j words take n lines; cut[n][j] is where line n starts.
  const k = words.length;
  const widest = [[0, ...words.map(() => Infinity)]];
  const cut: number[][] = [[]];
  let best = { size: 0, lines: [[0, k]] };
  for (let n = 1; n <= k; n++) {
    widest[n] = Array(k + 1).fill(Infinity);
    cut[n] = Array(k + 1).fill(0);
    for (let j = n; j <= k; j++) {
      for (let m = n - 1; m < j; m++) {
        const w = Math.max(widest[n - 1][m], span(m, j));
        if (w < widest[n][j]) {
          widest[n][j] = w;
          cut[n][j] = m;
        }
      }
    }
    const block = widest[n][k],
      tall = n * LINE_HEIGHT;
    const size = Math.min(
      (width * 0.72) / (block * cos + tall * sin),
      (height * 0.72) / (block * sin + tall * cos),
      Math.min(width, height) * 0.36,
    );
    if (size > best.size) {
      const lines: number[][] = [];
      for (let line = n, end = k; line > 0; end = cut[line][end], line--) {
        lines.unshift([cut[line][end], end]);
      }
      best = { size, lines };
    }
  }
  return { degrees: (-angle * 180) / Math.PI, size: Math.max(6, best.size), lines: best.lines };
}
/** App-icon faces show the icon alone: 60% of the shorter edge, scaled, always clear of the face's 12px padding. */
export function appIconSize(width: number, height: number, scale = 1) {
  const edge = Math.max(0, Math.min(width, height));
  return Math.max(0, Math.min(edge * 0.6 * scale, edge - 24));
}

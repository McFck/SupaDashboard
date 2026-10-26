// Default accent palette: vivid hues that stay readable on dark glass (Xeneon-inspired, not copied).
export const ACCENTS = [
  '#67c9eb', '#8ea8f0', '#b5a0e8', '#df9bc5', '#ee969d', '#eeb18a',
  '#e9c878', '#bbd58a', '#7dcca6', '#79ccc5', '#66ce8f', '#edf0f7',
];

/** Split "#rrggbb" / "#rrggbbaa" into colour and 0..1 opacity, and join them back. */
export function splitAlpha(color: string) {
  const hex = color.length === 9 ? color.slice(0, 7) : color;
  const alpha = color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1;
  return { hex, alpha };
}
export const withAlpha = (hex: string, alpha: number) =>
  alpha >= 1 ? hex : `${hex}${Math.round(Math.max(0, alpha) * 255).toString(16).padStart(2, '0')}`;

/** HSV (h 0..360, s/v 0..1) to "#rrggbb" and back, for the colour picker. */
export function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}
export function hexToHsv(hex: string) {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0;
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0, v: max };
}

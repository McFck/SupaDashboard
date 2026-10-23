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

import type { SkinDesignFit } from './contracts';

export function fitSkinDesign(
  width: number,
  height: number,
  designWidth: number,
  designHeight: number,
): SkinDesignFit | null {
  if (
    ![width, height, designWidth, designHeight].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    designWidth <= 0 ||
    designHeight <= 0
  )
    return null;
  const scale = Math.min(width / designWidth, height / designHeight);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return {
    scale,
    offsetX: (width - designWidth * scale) / 2,
    offsetY: (height - designHeight * scale) / 2,
  };
}

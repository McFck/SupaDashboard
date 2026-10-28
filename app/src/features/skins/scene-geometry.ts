import type { SceneRect } from './scene-contracts';

export function mapScenePoint(
  clientX: number,
  clientY: number,
  rect: SceneRect,
  width: number,
  height: number,
) {
  if (
    ![clientX, clientY, rect.left, rect.top, rect.width, rect.height, width, height].every(
      Number.isFinite,
    ) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    width <= 0 ||
    height <= 0
  )
    return null;
  const x = ((clientX - rect.left) * width) / rect.width;
  const y = ((clientY - rect.top) * height) / rect.height;
  return x < 0 || y < 0 || x >= width || y >= height ? null : { x, y };
}

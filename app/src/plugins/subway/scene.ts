import type { SkinSceneFactory, SkinSceneRenderer } from '../../core/skin-scene';
import type { LineDefinition } from './lines';

export type SubwaySceneData = { line: LineDefinition | null };

export const createSubwayScene: SkinSceneFactory<SubwaySceneData> = (): SkinSceneRenderer<SubwaySceneData> => ({
  draw({ ctx, width, height }) {
    ctx.fillStyle = '#10171b';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#192328';
    ctx.fillRect(48, 48, width - 96, height - 96);
    ctx.fillStyle = '#26343a';
    ctx.fillRect(72, 72, width - 144, 4);
    ctx.fillRect(72, height - 76, width - 144, 4);
    return false;
  },
  input(_event) {},
});

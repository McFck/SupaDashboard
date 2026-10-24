import type { SkinSceneFactory, SkinSceneRenderer } from '../../core/skin-scene';
import { createHibiyaRenderer, scheduleHibiyaPair } from './lcd/hibiya';
import { createSakaisujiRenderer } from './lcd/sakaisuji';
import { createYamanoteRenderer } from './lcd/yamanote';
import { scheduleScreen } from './screens';
import type { SubwaySceneState } from './runtime';

export type SubwaySceneData = SubwaySceneState & { visibleElapsed: number };

export const createSubwayScene: SkinSceneFactory<SubwaySceneData | undefined> = (): SkinSceneRenderer<SubwaySceneData | undefined> => {
  const yamanote = createYamanoteRenderer();
  const hibiya = createHibiyaRenderer();
  const sakaisuji = createSakaisujiRenderer();
  return {
    draw({ ctx, width, height, view, data }) {
      ctx.fillStyle = '#10171b';
      ctx.fillRect(0, 0, width, height);
      if (data?.line.id === 'yamanote') {
        const languages = Array.isArray(data.config.displayLanguages) ? data.config.displayLanguages as string[]
          : Array.isArray(data.config.languages) ? data.config.languages as string[] : ['ja', 'en'];
        const model = scheduleScreen(data.snapshot, {
          line: data.line, languages, manualView: view === 'map' ? 'map' : undefined,
        }, data.visibleElapsed);
        yamanote.draw(ctx, width, height, model);
      } else if (data?.line.id === 'hibiya') {
        const languages = Array.isArray(data.config.displayLanguages) ? data.config.displayLanguages as string[]
          : Array.isArray(data.config.languages) ? data.config.languages as string[] : ['ja', 'en'];
        const pair = scheduleHibiyaPair(data.snapshot, {
          line: data.line, languages, manualView: view === 'map' ? 'map' : undefined,
        }, data.visibleElapsed);
        hibiya.draw(ctx, width, height, pair);
      } else if (data?.line.id === 'sakaisuji') {
        const languages = Array.isArray(data.config.displayLanguages) ? data.config.displayLanguages as string[]
          : Array.isArray(data.config.languages) ? data.config.languages as string[] : ['ja', 'kana'];
        const model = scheduleScreen(data.snapshot, {
          line: data.line, languages, manualView: view === 'map' ? 'map' : undefined,
        }, data.visibleElapsed);
        sakaisuji.draw(ctx, width, height, model);
      }
      return false;
    },
    input(_event) {},
    dispose() { yamanote.dispose(); hibiya.dispose(); sakaisuji.dispose(); },
  };
};

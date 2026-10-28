import type { SkinSceneFactory, SkinSceneRenderer } from '../../../features/skins/scene-contracts';
import { createHibiyaRenderer, scheduleHibiyaPair } from './lcd/hibiya';
import { createSakaisujiRenderer } from './lcd/sakaisuji';
import { createYamanoteRenderer } from './lcd/yamanote';
import { displayLanguages, normalizeCarNumber } from '../simulation/config';
import { scheduleScreen } from './screens';
import type { SubwaySceneState } from '../simulation/runtime';

export type SubwaySceneData = SubwaySceneState & { visibleElapsed: number; clockLabel?: string };
export const subwaySceneLifecycle = { created: 0, disposed: 0 };

// Snapshot identity also changes for audio and control updates; only LCD content invalidates paint.
export function subwaySceneRevision(data: SubwaySceneData | undefined, view: string): string {
  if (!data) return 'loading';
  const config = {
    line: data.line,
    languages: languagesFor(data),
    currentCar: normalizeCarNumber(data.config.carNumber, data.line.carCount),
    clock: data.clockLabel,
    manualView: view === 'display' ? ('display' as const) : ('map' as const),
  };
  if (data.line.id === 'hibiya') {
    const pair = scheduleHibiyaPair(data.snapshot, config, data.visibleElapsed);
    return `${pair.left.invalidationKey}|${pair.right.invalidationKey}`;
  }
  return scheduleScreen(data.snapshot, config, data.visibleElapsed).invalidationKey;
}

const BACKGROUND = '#10171b';

function languagesFor(data: SubwaySceneData): string[] {
  const raw = data.config.displayLanguages ?? data.config.languages;
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string');
  return displayLanguages(
    typeof raw === 'string' ? raw : data.line.id === 'sakaisuji' ? 'ja-kana' : 'ja-en',
  );
}

export const createSubwayScene: SkinSceneFactory<
  SubwaySceneData | undefined
> = (): SkinSceneRenderer<SubwaySceneData | undefined> => {
  subwaySceneLifecycle.created++;
  const yamanote = createYamanoteRenderer();
  const hibiya = createHibiyaRenderer();
  const sakaisuji = createSakaisujiRenderer();
  return {
    draw({ ctx, width, height, view, data, time }) {
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, width, height);
      if (!data) return false;
      const isMap = view === 'map' || view === 'cab';
      const viewportWidth = width;
      const viewportHeight = height;
      const viewport = { width: viewportWidth, height: viewportHeight };
      const languages = languagesFor(data);
      const screenView = isMap ? 'map' : 'display';
      if (data.line.id === 'yamanote') {
        const model = scheduleScreen(
          data.snapshot,
          {
            line: data.line,
            languages,
            currentCar: normalizeCarNumber(data.config.carNumber, data.line.carCount),
            clock: data.clockLabel,
            manualView: screenView,
          },
          data.visibleElapsed,
        );
        return yamanote.draw(ctx, viewport.width, viewport.height, model, time);
      } else if (data.line.id === 'hibiya') {
        const pair = scheduleHibiyaPair(
          data.snapshot,
          {
            line: data.line,
            languages,
            currentCar: normalizeCarNumber(data.config.carNumber, data.line.carCount),
            manualView: screenView,
          },
          data.visibleElapsed,
        );
        return hibiya.draw(ctx, viewport.width, viewport.height, pair, time);
      } else if (data.line.id === 'sakaisuji') {
        const model = scheduleScreen(
          data.snapshot,
          {
            line: data.line,
            languages,
            currentCar: normalizeCarNumber(data.config.carNumber, data.line.carCount),
            manualView: screenView,
          },
          data.visibleElapsed,
        );
        sakaisuji.draw(ctx, viewport.width, viewport.height, model);
      }
      return false;
    },
    input(_event) {},
    dispose() {
      subwaySceneLifecycle.disposed++;
      yamanote.dispose();
      hibiya.dispose();
      sakaisuji.dispose();
    },
  };
};

import type {
  AppletSceneFactory,
  AppletSceneRenderer,
} from '../../../features/applets/scene-contracts';
import { createHibiyaRenderer } from '../display/tokyo-metro-13000/renderer';
import { scheduleHibiyaPair } from '../display/tokyo-metro-13000/schedule';
import { createHankyu1300Renderer } from '../display/hankyu-1300/renderer';
import { createYamanoteRenderer } from '../display/e235/renderer';
import { e235Images } from '../display/e235/images';
import { e235WallClock } from '../display/e235/schedule';
import { displayLanguages, normalizeCarNumber } from '../simulation/config';
import { scheduleScreen, type ScreenConfig } from './screens';
import type { SubwaySceneState } from '../simulation/runtime';
import type { PreparedFrame, SubwayScreen } from './contracts';

export type SubwaySceneData = SubwaySceneState & { visibleElapsed: number; wallMs?: number };

const BACKGROUND = '#10171b';

export function sceneLanguages(source: SubwaySceneState): string[] {
  const raw = source.config.displayLanguages ?? source.config.languages;
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string');
  }
  return displayLanguages(
    typeof raw === 'string' ? raw : source.line.id === 'sakaisuji' ? 'ja-kana' : 'ja-en',
  );
}

export function prepareFrame(
  data: SubwaySceneData,
  view: string,
  screen: SubwayScreen,
): PreparedFrame {
  const { line, snapshot, visibleElapsed } = data;
  const wall =
    line.id === 'yamanote' && data.wallMs !== undefined ? e235WallClock(data.wallMs) : undefined;
  const config: ScreenConfig = {
    line,
    languages: sceneLanguages(data),
    currentCar: normalizeCarNumber(data.config.carNumber, line.carCount),
    clock: wall?.label,
    manualView: view === 'map' || view === 'cab' ? 'map' : 'display',
  };
  const minuteMs = wall?.wakeInMs ?? Infinity;
  const wake = (nextDeadline: number | null) => {
    const delay = Math.min(
      nextDeadline === null ? Infinity : nextDeadline - visibleElapsed,
      minuteMs,
    );
    return Number.isFinite(delay) ? Math.max(0, delay) : null;
  };
  if (line.id === 'hibiya') {
    const pair = scheduleHibiyaPair(snapshot, config, visibleElapsed);
    const panel = screen === 'right' ? 1 : 0;
    const shown = panel === 1 ? pair.right : pair.left;
    return {
      kind: 'pair',
      line,
      pair,
      panel,
      revision: `${panel}|${shown.invalidationKey}`,
      wakeInMs: wake(shown.nextDeadline),
    };
  }
  const schedule = scheduleScreen(snapshot, config, visibleElapsed);
  return {
    kind: 'screen',
    line,
    schedule,
    // Late images repaint through the revision; nothing polls for them.
    revision:
      line.id === 'yamanote'
        ? `${schedule.invalidationKey}|${e235Images.revision}`
        : schedule.invalidationKey,
    wakeInMs: wake(schedule.nextDeadline),
  };
}

export const createSubwayScene: AppletSceneFactory<
  PreparedFrame | undefined
> = (): AppletSceneRenderer<PreparedFrame | undefined> => {
  // A display's renderer (and its layer cache) exists only once its line is shown.
  const opened: { dispose(): void }[] = [];
  const once = <T extends { dispose(): void }>(create: () => T) => {
    let renderer: T | undefined;
    return () => {
      if (!renderer) {
        renderer = create();
        opened.push(renderer);
      }
      return renderer;
    };
  };
  const yamanote = once(createYamanoteRenderer);
  const hibiya = once(createHibiyaRenderer);
  const sakaisuji = once(createHankyu1300Renderer);
  return {
    draw({ ctx, width, height, data, time }) {
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, width, height);
      if (!data) {
        return false;
      }
      if (data.kind === 'pair') {
        return hibiya().draw(ctx, width, height, data.pair, time, data.panel);
      }
      if (data.line.id === 'yamanote') {
        return yamanote().draw(ctx, width, height, data.schedule, time);
      }
      sakaisuji().draw(ctx, width, height, data.schedule);
      return false;
    },
    dispose() {
      for (const renderer of opened) {
        renderer.dispose();
      }
    },
  };
};

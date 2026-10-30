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
import { displayAspect } from './composition';

export type SubwaySceneData = SubwaySceneState & { visibleElapsed: number; wallMs?: number };

const BACKGROUND = '#10171b';

/**
 * The renderers centre their LCD at its own ratio; where the canvas is wider or taller, the LCD's outermost
 * pixel columns or rows are stretched into the spare room so the display runs edge to edge without bars.
 */
function extendEdges(ctx: CanvasRenderingContext2D, width: number, height: number, aspect: number) {
  const w = Math.min(width, height * aspect),
    h = w / aspect;
  const x = (width - w) / 2,
    y = (height - h) / 2;
  if (x < 0.5 && y < 0.5) {
    return;
  }
  // Sources are backing pixels; one pixel inside the edge skips the antialiased boundary.
  const { a: sx, d: sy } = ctx.getTransform();
  const canvas = ctx.canvas;
  if (x >= 0.5) {
    const left = Math.ceil(x * sx) + 1,
      right = Math.floor((x + w) * sx) - 2;
    ctx.drawImage(canvas, left, 0, 1, canvas.height, 0, 0, x, height);
    ctx.drawImage(canvas, right, 0, 1, canvas.height, x + w, 0, x, height);
  } else {
    // Text runs close to the LCD's top and bottom edges, so a row would smear it; its corner pixel is the
    // background there.
    const top = Math.ceil(y * sy) + 1,
      bottom = Math.floor((y + h) * sy) - 2;
    ctx.drawImage(canvas, 1, top, 1, 1, 0, 0, width, y);
    ctx.drawImage(canvas, 1, bottom, 1, 1, 0, y + h, width, y);
  }
}

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
      let animating = false;
      if (data.kind === 'pair') {
        animating = hibiya().draw(ctx, width, height, data.pair, time, data.panel);
      } else if (data.line.id === 'yamanote') {
        animating = yamanote().draw(ctx, width, height, data.schedule, time);
      } else {
        sakaisuji().draw(ctx, width, height, data.schedule);
      }
      extendEdges(ctx, width, height, displayAspect(data.line.id));
      return animating;
    },
    dispose() {
      for (const renderer of opened) {
        renderer.dispose();
      }
    },
  };
};

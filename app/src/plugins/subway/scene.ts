import type { SkinSceneFactory, SkinSceneRenderer } from '../../core/skin-scene';
import { createHibiyaRenderer, scheduleHibiyaPair } from './lcd/hibiya';
import { createSakaisujiRenderer } from './lcd/sakaisuji';
import { createYamanoteRenderer } from './lcd/yamanote';
import { displayLanguages } from './config';
import { scheduleScreen } from './screens';
import type { SubwaySceneState } from './runtime';

export type SubwaySceneData = SubwaySceneState & { visibleElapsed: number };

const BACKGROUND = '#10171b';
const PANEL = '#182127';
const MUTED = '#99a7ae';

function languagesFor(data: SubwaySceneData): string[] {
  const raw = data.config.displayLanguages ?? data.config.languages;
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string');
  return displayLanguages(typeof raw === 'string' ? raw : data.line.id === 'sakaisuji' ? 'ja-kana' : 'ja-en');
}

function drawRunSummary(ctx: CanvasRenderingContext2D, data: SubwaySceneData, x: number, y: number, width: number, height: number): void {
  const { snapshot, line } = data;
  const next = line.stations.find(station => station.code === snapshot.next);
  const current = line.stations.find(station => station.code === snapshot.station);
  const direction = line.directions.find(item => item.id === snapshot.direction);
  ctx.save();
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = line.color;
  ctx.fillRect(x, y, 8, height);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f3f6f7';
  ctx.font = '700 30px Arial, sans-serif';
  ctx.fillText(`${line.names.en}  ·  ${snapshot.station}${snapshot.next ? ` → ${snapshot.next}` : ' · terminal'}`, x + 32, y + 38, width - 64);
  ctx.fillStyle = MUTED;
  ctx.font = '500 21px Arial, sans-serif';
  const destination = direction?.names.en ?? '';
  ctx.fillText(`${current?.names.en ?? snapshot.station}${next ? ` to ${next.names.en}` : ''}  ·  ${destination}  ·  ${snapshot.state}`, x + 32, y + 78, width - 64);
  const progress = Math.max(0, Math.min(1, snapshot.progress));
  const railY = y + height - 31;
  ctx.fillStyle = '#29343a';
  ctx.fillRect(x + 32, railY, width - 64, 8);
  ctx.fillStyle = line.color;
  ctx.fillRect(x + 32, railY, (width - 64) * progress, 8);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f3f6f7';
  ctx.font = '600 19px Arial, sans-serif';
  ctx.fillText(`${Math.round(snapshot.speed)} km/h  ·  ${snapshot.remainingMinutes} min`, x + width - 32, y + 78, width - 80);
  ctx.restore();
}

export const createSubwayScene: SkinSceneFactory<SubwaySceneData | undefined> = (): SkinSceneRenderer<SubwaySceneData | undefined> => {
  const yamanote = createYamanoteRenderer();
  const hibiya = createHibiyaRenderer();
  const sakaisuji = createSakaisujiRenderer();
  return {
    draw({ ctx, width, height, view, data }) {
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, width, height);
      if (!data) return false;
      const isRun = view === 'cab';
      const isMap = view === 'map' || isRun;
      const viewportWidth = isRun ? Math.min(1664, width) : width;
      const summaryHeight = isMap ? Math.min(isRun ? 192 : 128, height * 0.18) : 0;
      const viewportHeight = isMap ? height - summaryHeight - 24 : height;
      const viewport = { width: viewportWidth, height: viewportHeight };
      const languages = languagesFor(data);
      const screenView = isMap ? 'map' : 'display';
      if (data.line.id === 'yamanote') {
        const model = scheduleScreen(data.snapshot, { line: data.line, languages, manualView: screenView }, data.visibleElapsed);
        yamanote.draw(ctx, viewport.width, viewport.height, model);
      } else if (data.line.id === 'hibiya') {
        const pair = scheduleHibiyaPair(data.snapshot, { line: data.line, languages, manualView: screenView }, data.visibleElapsed);
        hibiya.draw(ctx, viewport.width, viewport.height, pair);
      } else if (data.line.id === 'sakaisuji') {
        const model = scheduleScreen(data.snapshot, { line: data.line, languages, manualView: screenView }, data.visibleElapsed);
        sakaisuji.draw(ctx, viewport.width, viewport.height, model);
      }
      if (isMap) drawRunSummary(ctx, data, isRun ? 32 : 32, viewportHeight + 16, viewportWidth - 64, summaryHeight - 24);
      return false;
    },
    input(_event) {},
    dispose() { yamanote.dispose(); hibiya.dispose(); sakaisuji.dispose(); },
  };
};

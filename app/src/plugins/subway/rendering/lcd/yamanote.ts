import type { ScreenSchedule } from '../screens';
import {
  drawE235Detailed,
  drawE235Header,
  drawE235Overlay,
  drawE235RouteMap,
  E235_WIDTH,
} from './e235';
import { drawE235Page, drawE235PageOverlay, e235Images } from './e235-pages';
import { CanvasLayerCache } from '../engine/canvas-cache';
import { paintFitted } from '../engine/canvas-renderer';
import { drawFittedText, E235_COLORS as C } from './shared';

const YAMANOTE_LCD_WIDTH = 1280;
const E235_SCALE = YAMANOTE_LCD_WIDTH / E235_WIDTH;

function drawStatic(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1280, 720);
  ctx.save();
  ctx.scale(E235_SCALE, E235_SCALE);
  drawE235Header(ctx, model);
  if (model.page === 'broad') drawE235RouteMap(ctx, model);
  else if (model.page === 'nearby') drawE235Detailed(ctx, model);
  else if (!['emergency', 'suspension'].includes(model.page)) drawE235Page(ctx, model);
  ctx.restore();
  if (!['emergency', 'suspension'].includes(model.page)) return;
  ctx.fillStyle = '#eed85b';
  ctx.beginPath();
  ctx.moveTo(112, 300);
  ctx.lineTo(210, 480);
  ctx.lineTo(14, 480);
  ctx.closePath();
  ctx.fill();
  drawFittedText(ctx, '!', 112, 420, 90, 108, 90, C.ink, 700, 'Arial, sans-serif', 'center');
  const strings =
    model.page === 'emergency'
      ? ['緊急停止しました', 'Emergency stop', '紧急停车', '비상 정차']
      : ['運転を見合わせています', 'Service suspended', '暂停服务', '운행 중단'];
  strings.forEach((text, i) => drawFittedText(ctx, text, 264, 304 + i * 84, 940, 46, 28, C.ink));
}

function overlay(ctx: CanvasRenderingContext2D, model: ScreenSchedule, time: number) {
  ctx.save();
  ctx.scale(E235_SCALE, E235_SCALE);
  const map = drawE235Overlay(ctx, model, time),
    page = drawE235PageOverlay(ctx, model, time);
  ctx.restore();
  return map || page;
}

export function createYamanoteRenderer() {
  void e235Images.acquire();
  const cache = new CanvasLayerCache(12);
  let animationKey = '',
    animationOrigin = 0;
  return {
    draw(
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      model: ScreenSchedule,
      time = 0,
    ) {
      const session = [
        model.snapshot.generation,
        model.snapshot.station,
        model.snapshot.next,
        model.snapshot.state,
        model.page,
        model.viewingSide,
      ].join('|');
      if (session !== animationKey) {
        animationKey = session;
        animationOrigin = time;
      }
      return paintFitted(ctx, width, height, 1280, 720, () => {
        const key =
          model.invalidationKey + '|' + e235Images.revision + '|' + (Math.floor(time / 3000) % 12);
        if (
          !cache.draw(ctx, key, 1280, 720, (layer) =>
            drawStatic(layer, { ...model, visibleElapsed: time }),
          )
        )
          drawStatic(ctx, { ...model, visibleElapsed: time });
        return overlay(ctx, model, time - animationOrigin);
      });
    },
    get cacheSize() {
      return cache.size;
    },
    dispose() {
      cache.clear();
    },
  };
}

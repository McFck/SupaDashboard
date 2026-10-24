import type { ScreenSchedule } from '../screens';
import { CanvasLayerCache, drawBadge, drawFittedText, drawProgressBar, drawStationName, E235_COLORS, fittedFont } from './shared';

export const YAMANOTE_LCD_WIDTH = 1280;
export const YAMANOTE_LCD_HEIGHT = 720;

export function yamanoteLayout() {
  return Object.freeze({
    width: YAMANOTE_LCD_WIDTH, height: YAMANOTE_LCD_HEIGHT,
    header: { x: 0, y: 0, width: 1280, height: 216 },
    direction: { x: 0, y: 0, width: 346, height: 216 },
    separator: { x: 346, y: 0, width: 16, height: 216 },
    main: { x: 382, y: 0, width: 738, height: 216 },
    body: { x: 0, y: 216, width: 1280, height: 504 },
    doorPanel: { x: 0, y: 520, width: 1280, height: 200 },
  });
}

export function yamanoteNearbyLabelLayout(pointX: number, next: boolean): { centerX: number; width: number } {
  const width = next ? 360 : 220;
  const margin = 24;
  return { centerX: Math.max(margin + width / 2, Math.min(YAMANOTE_LCD_WIDTH - margin - width / 2, pointX)), width };
}

export function isTransferBadge(value: string): boolean {
  return /^[A-Z]{1,2}\d{1,2}$/.test(value);
}

function label(model: ScreenSchedule, values: Record<string, string>): string {
  return values[model.language] ?? values.en ?? values.ja ?? '';
}

function stationInHeader(model: ScreenSchedule) {
  return model.snapshot.state === 'doorsClosing' || model.snapshot.state === 'approaching'
    ? model.nextStation ?? model.station
    : model.station;
}

function headerState(model: ScreenSchedule): string {
  const byState: Record<string, Record<string, string>> = {
    stopped: { ja: '停車中', en: 'Stopped' },
    doorsClosing: { ja: 'ドアが閉まります', en: 'Doors closing' },
    departing: { ja: '発車します', en: 'Departing' },
    cruising: { ja: '次は', en: 'Next' },
    approaching: { ja: 'まもなく', en: 'Approaching' },
    arriving: { ja: '到着', en: 'Arriving' },
    emergency: { ja: '緊急停止', en: 'Emergency stop' },
    suspended: { ja: '運転見合わせ', en: 'Service suspended' },
  };
  return label(model, byState[model.snapshot.state] ?? {});
}

function drawHeader(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  const current = stationInHeader(model);
  const direction = model.line.directions.find(item => item.id === model.snapshot.direction);
  const destination = model.destination;
  ctx.fillStyle = E235_COLORS.header;
  ctx.fillRect(0, 0, 1280, 216);
  ctx.fillStyle = E235_COLORS.route;
  ctx.fillRect(346, 0, 16, 216);
  drawBadge(ctx, 'JY', 46, 36, 54, E235_COLORS.route);
  const directionName = direction?.names[model.language] ?? direction?.names.ja ?? direction?.names.en ?? direction?.id ?? '';
  drawFittedText(ctx, directionName, 120, 64, 200, 30, 22, E235_COLORS.white, 700,
    model.language === 'ja' ? 'Yu Gothic, Meiryo, sans-serif' : 'Arial, sans-serif');
  drawFittedText(ctx, destination, 48, 126, 274, 34, 22, E235_COLORS.white, 700,
    model.language === 'ja' ? 'Yu Gothic, Meiryo, sans-serif' : 'Arial, sans-serif');
  drawFittedText(ctx, headerState(model), 48, 178, 274, 30, 21, '#d8dfe2', 600,
    model.language === 'ja' ? 'Yu Gothic, Meiryo, sans-serif' : 'Arial, sans-serif');

  drawFittedText(ctx, current.code, 386, 38, 110, 23, 18, '#d6dde0', 700);
  const name = current.names[model.language] ?? current.names.ja ?? current.names.en ?? current.code;
  const family = model.language === 'ja' ? 'Yu Gothic, Meiryo, sans-serif' : 'Arial, sans-serif';
  ctx.font = fittedFont(ctx, name, 696, 126, 86, 700, family);
  ctx.fillStyle = E235_COLORS.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 386, 108, 696);

  ctx.fillStyle = '#252c2f';
  ctx.fillRect(1136, 20, 116, 176);
  drawFittedText(ctx, `${model.snapshot.remainingMinutes}`, 1194, 70, 92, 46, 28, E235_COLORS.white, 700, 'Arial, sans-serif', 'center');
  drawFittedText(ctx, label(model, { ja: '分', en: 'min' }), 1194, 112, 92, 24, 18, '#d6dde0', 600, 'Arial, sans-serif', 'center');
  drawFittedText(ctx, label(model, { ja: '11両', en: '11 cars' }), 1194, 164, 100, 24, 18, '#d6dde0', 600, 'Arial, sans-serif', 'center');
}

function drawPlatform(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = E235_COLORS.body;
  ctx.fillRect(0, 216, 1280, 504);
  drawFittedText(ctx, label(model, { ja: '乗車位置', en: 'Train formation' }), 54, 258, 480, 28, 20, E235_COLORS.ink, 700,
    model.language === 'ja' ? 'Yu Gothic, Meiryo, sans-serif' : 'Arial, sans-serif');
  const left = 50, top = 302, gap = 8, carWidth = (1180 - 10 * gap) / 11;
  for (let car = 1; car <= 11; car++) {
    const x = left + (car - 1) * (carWidth + gap);
    ctx.fillStyle = car === model.currentCar ? E235_COLORS.currentCar : '#dce2e5';
    ctx.fillRect(x, top, carWidth, 98);
    ctx.strokeStyle = car === model.currentCar ? '#8e1d21' : '#7d898f';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, top + 1, carWidth - 2, 96);
    ctx.fillStyle = car === model.currentCar ? E235_COLORS.white : E235_COLORS.ink;
    ctx.font = '700 20px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(car), x + carWidth / 2, top + 50);
  }
  const facilities = model.station.platformByDirection[model.snapshot.direction]?.facilities ?? [];
  for (const facility of facilities) {
    const x = facility.relativePosition === null ? left + (facility.car ?? 1) * (carWidth + gap) : left + facility.relativePosition * 1180;
    ctx.fillStyle = E235_COLORS.exit;
    ctx.beginPath(); ctx.arc(x, 420, 13, 0, Math.PI * 2); ctx.fill();
    drawFittedText(ctx, facility.label, x + 20, 420, 180, 18, 14, E235_COLORS.ink, 600);
  }

  ctx.fillStyle = E235_COLORS.doorPanel;
  ctx.fillRect(0, 520, 1280, 200);
  drawDoorGlyph(ctx, 532, 548, 216, 150, model.snapshot.doors);
  const state = model.sideLabel ? `${model.sideLabel} doors` : '';
  if (state) drawFittedText(ctx, state, 792, 600, 380, 38, 24, E235_COLORS.white, 700);
  if (model.snapshot.doors === 'open') {
    ctx.fillStyle = E235_COLORS.exit;
    ctx.fillRect(754, 670, 10, 10);
  }
}

function drawDoorGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
  doors: string): void {
  ctx.fillStyle = '#f1f4f5';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = doors === 'open' ? '#cbd9e3' : '#a9bac7';
  const center = x + width / 2;
  const half = doors === 'open' ? width * 0.37 : width * 0.49;
  ctx.fillRect(x + 12, y + 12, half - 12, height - 24);
  ctx.fillRect(center + (doors === 'open' ? width * 0.13 : 0), y + 12, half - 12, height - 24);
  ctx.strokeStyle = '#647681'; ctx.lineWidth = 5;
  ctx.strokeRect(x + 12, y + 12, width - 24, height - 24);
  ctx.beginPath(); ctx.moveTo(center, y + 12); ctx.lineTo(center, y + height - 12); ctx.stroke();
}

function drawNearby(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = E235_COLORS.body; ctx.fillRect(0, 216, 1280, 504);
  const points = [
    { x: 110, y: 482, r: 26 }, { x: 366, y: 365, r: 40 }, { x: 640, y: 292, r: 82 },
    { x: 914, y: 365, r: 46 }, { x: 1170, y: 482, r: 30 },
  ];
  ctx.strokeStyle = E235_COLORS.route; ctx.lineWidth = 13; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
  model.nearby.slice(0, points.length).forEach((station, index) => {
    const point = points[index];
    const next = station.code === model.snapshot.next;
    ctx.fillStyle = next ? E235_COLORS.route : E235_COLORS.white;
    ctx.strokeStyle = E235_COLORS.route; ctx.lineWidth = next ? 9 : 6;
    ctx.beginPath(); ctx.arc(point.x, point.y, point.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const name = yamanoteNearbyLabelLayout(point.x, next);
    drawStationName(ctx, station, model.language, name.centerX, point.y + point.r + 32,
      name.width, next ? 34 : 25, 18, E235_COLORS.ink, 'center');
    drawFittedText(ctx, station.code, point.x, point.y, point.r * 1.55, next ? 27 : 18, 13,
      next ? E235_COLORS.white : E235_COLORS.route, 700, 'Arial, sans-serif', 'center');
  });
}

export function yamanoteBroadNodePositions(count: number, directionDelta: 1 | -1): readonly { x: number; y: number }[] {
  if (!Number.isInteger(count) || count < 1) return [];
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + directionDelta * index * (Math.PI * 2 / count);
    return { x: 640 + 500 * Math.cos(angle), y: 470 + 180 * Math.sin(angle) };
  });
}

function drawBroad(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = E235_COLORS.body; ctx.fillRect(0, 216, 1280, 504);
  const directionDelta = model.line.directions.find(item => item.id === model.snapshot.direction)?.delta ?? 1;
  const points = yamanoteBroadNodePositions(model.route.length, directionDelta);
  ctx.strokeStyle = E235_COLORS.route; ctx.lineWidth = 8;
  ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  if (model.line.loop) ctx.closePath(); ctx.stroke();
  model.route.forEach((station, index) => {
    const point = points[index];
    if (!point) return;
    const current = station.code === model.snapshot.station;
    ctx.fillStyle = current ? E235_COLORS.currentCar : E235_COLORS.white;
    ctx.strokeStyle = current ? E235_COLORS.currentCar : E235_COLORS.route;
    ctx.lineWidth = current ? 5 : 3;
    ctx.beginPath(); ctx.arc(point.x, point.y, current ? 15 : 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawFittedText(ctx, station.code, point.x, point.y + 27, 52, 14, 11,
      current ? E235_COLORS.currentCar : E235_COLORS.ink, 700, 'Arial, sans-serif', 'center');
  });
  const current = model.station.names[model.language] ?? model.station.names.ja ?? model.station.code;
  drawFittedText(ctx, current, 640, 470, 300, 30, 20, E235_COLORS.ink, 700,
    model.language === 'ja' ? 'Yu Gothic, Meiryo, sans-serif' : 'Arial, sans-serif', 'center');
}

function drawTransfers(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = E235_COLORS.body; ctx.fillRect(0, 216, 1280, 504);
  drawFittedText(ctx, label(model, { ja: '乗り換え', en: 'Transfers' }), 64, 276, 600, 42, 30, E235_COLORS.ink, 700,
    model.language === 'ja' ? 'Yu Gothic, Meiryo, sans-serif' : 'Arial, sans-serif');
  if (!model.transfers.length) return;
  const columns = Math.min(4, model.transfers.length);
  const cardWidth = 1100 / columns;
  model.transfers.forEach((transfer, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const centerX = 90 + (column + 0.5) * cardWidth;
    const top = 350 + row * 144;
    if (isTransferBadge(transfer)) {
      drawBadge(ctx, transfer, centerX - 38, top, 76, transfer.startsWith('JY') ? '#4aa235' : '#8c6b9a');
      return;
    }
    const family = model.language === 'ja' || model.language === 'zh' ? 'Yu Gothic, Meiryo, sans-serif' : 'Arial, sans-serif';
    drawFittedText(ctx, transfer, centerX, top + 48, cardWidth - 24, 34, 18, E235_COLORS.ink, 700, family, 'center');
  });
}

function drawIncident(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = '#f6f6f4'; ctx.fillRect(0, 216, 1280, 504);
  ctx.fillStyle = '#fff3c6'; ctx.fillRect(0, 216, 1280, 6);
  ctx.fillStyle = '#edc83d';
  ctx.beginPath(); ctx.moveTo(104, 306); ctx.lineTo(204, 480); ctx.lineTo(4, 480); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#202629'; ctx.font = '700 100px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('!', 104, 420);
  const strings = model.page === 'emergency'
    ? ['緊急停止しました', 'Emergency stop', '紧急停车', '비상 정차']
    : ['運転を見合わせています', 'Service suspended', '暂停服务', '운행 중단'];
  strings.forEach((text, index) => drawFittedText(ctx, text, 264, 302 + index * 82, 900, 42, 27,
    index ? '#3a4246' : '#15191b', 700, index === 0 || index === 2 ? 'Yu Gothic, Meiryo, sans-serif' : 'Arial, sans-serif'));
}

function drawStatic(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = E235_COLORS.body; ctx.fillRect(0, 0, YAMANOTE_LCD_WIDTH, YAMANOTE_LCD_HEIGHT);
  drawHeader(ctx, model);
  if (model.page === 'platform' || model.page === 'closing') drawPlatform(ctx, model);
  else if (model.page === 'nearby') drawNearby(ctx, model);
  else if (model.page === 'broad') drawBroad(ctx, model);
  else if (model.page === 'transfers') drawTransfers(ctx, model);
  else drawIncident(ctx, model);
}

export function drawYamanoteLCD(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  drawStatic(ctx, model);
  drawProgressBar(ctx, 0, 714, YAMANOTE_LCD_WIDTH, model.snapshot.progress);
}

export function createYamanoteRenderer() {
  const cache = new CanvasLayerCache(12);
  return {
    draw(ctx: CanvasRenderingContext2D, width: number, height: number, model: ScreenSchedule): void {
      const scale = Math.min(width / YAMANOTE_LCD_WIDTH, height / YAMANOTE_LCD_HEIGHT);
      const x = (width - YAMANOTE_LCD_WIDTH * scale) / 2;
      const y = (height - YAMANOTE_LCD_HEIGHT * scale) / 2;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      const painted = cache.draw(ctx, model.invalidationKey, YAMANOTE_LCD_WIDTH, YAMANOTE_LCD_HEIGHT,
        layer => drawStatic(layer, model));
      if (!painted) drawStatic(ctx, model);
      drawProgressBar(ctx, 0, 714, YAMANOTE_LCD_WIDTH, model.snapshot.progress);
      ctx.restore();
    },
    get cacheSize() { return cache.size; },
    dispose() { cache.clear(); },
  };
}

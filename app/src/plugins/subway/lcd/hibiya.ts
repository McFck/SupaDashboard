import { localizedName, type StationDefinition } from '../lines';
import { scheduleScreen, type ScreenConfig, type ScreenLanguage, type ScreenSchedule } from '../screens';
import type { RunSnapshot } from '../run';
import { CanvasLayerCache, drawBadge, drawFittedText, drawProgressBar } from './shared';

export const HIBIYA_PANEL_WIDTH = 1280;
export const HIBIYA_PANEL_HEIGHT = 720;
export const HIBIYA_MULLION_WIDTH = 32;
export const HIBIYA_LCD_WIDTH = HIBIYA_PANEL_WIDTH * 2 + HIBIYA_MULLION_WIDTH;
export const HIBIYA_LCD_HEIGHT = HIBIYA_PANEL_HEIGHT;
const PANEL_STATIONS = 8;
const C = Object.freeze({
  header: '#e3e8eb', ink: '#15191b', route: '#9caeb7', caution: '#efd83d', white: '#ffffff',
  past: '#b9bec0', current: '#cb292d', next: '#d8e590', body: '#f7f8f8',
});

export interface HibiyaPairSchedule {
  readonly left: ScreenSchedule;
  readonly right: ScreenSchedule;
}

const captions: Record<string, Partial<Record<ScreenLanguage, string>>> = {
  stopped: { ja: '停車中', kana: 'ていしゃちゅう', en: 'Stopped', zh: '停靠中', ko: '정차 중' },
  doorsClosing: { ja: 'ドアが閉まります', kana: 'ドアがしまります', en: 'Doors closing', zh: '车门关闭', ko: '문이 닫힙니다' },
  departing: { ja: '発車します', kana: 'はっしゃします', en: 'Departing', zh: '即将发车', ko: '출발합니다' },
  cruising: { ja: '次は', kana: 'つぎは', en: 'Next', zh: '下一站', ko: '다음 역' },
  approaching: { ja: 'まもなく', kana: 'まもなく', en: 'Approaching', zh: '即将到达', ko: '곧 도착' },
  arriving: { ja: '到着', kana: 'とうちゃく', en: 'Arriving', zh: '到达', ko: '도착' },
  emergency: { ja: '緊急停止', kana: 'きんきゅうていし', en: 'Emergency stop', zh: '紧急停车', ko: '비상 정차' },
  suspended: { ja: '運転見合わせ', kana: 'うんてんみあわせ', en: 'Service suspended', zh: '暂停服务', ko: '운행 중단' },
  platform: { ja: '乗車位置', kana: 'じょうしゃいち', en: 'Platform positions', zh: '乘车位置', ko: '승차 위치' },
  nearby: { ja: '近くの駅', kana: 'ちかくのえき', en: 'Nearby stations', zh: '附近车站', ko: '주변 역' },
  transfers: { ja: '乗り換え案内', kana: 'のりかえあんない', en: 'Transfers', zh: '换乘', ko: '환승' },
  doors: { ja: 'ドア・安全案内', kana: 'ドア・あんぜんあんない', en: 'Doors and safety', zh: '车门与安全', ko: '문과 안전 안내' },
  open: { ja: 'ドアが開いています', kana: 'ドアがあいています', en: 'Doors open', zh: '车门已打开', ko: '문이 열려 있습니다' },
  closed: { ja: 'ドアが閉まっています', kana: 'ドアがしまっています', en: 'Doors closed', zh: '车门已关闭', ko: '문이 닫혀 있습니다' },
  approachingDoor: { ja: '停車後にドアが開きます', kana: 'ていしゃごにドアがあきます', en: 'Doors open after the train stops', zh: '列车停稳后车门将打开', ko: '열차가 정차한 뒤 문이 열립니다' },
  thisSide: { ja: 'こちら側', kana: 'こちらがわ', en: 'This side', zh: '本侧', ko: '이쪽' },
  oppositeSide: { ja: '反対側', kana: 'はんたいがわ', en: 'Opposite side', zh: '对侧', ko: '반대쪽' },
  bothSides: { ja: '両側', kana: 'りょうがわ', en: 'Both sides', zh: '两侧', ko: '양쪽' },
};

function phrase(language: ScreenLanguage, key: string): string {
  const values = captions[key];
  return values?.[language] ?? values?.ja ?? values?.en ?? key;
}

export function scheduleHibiyaPair(snapshot: RunSnapshot, config: ScreenConfig, visibleElapsed: number): HibiyaPairSchedule {
  if (config.line.id !== 'hibiya') throw new Error('Hibiya panel pair requires the Hibiya line');
  return Object.freeze({
    left: scheduleScreen(snapshot, { ...config, languageOffset: config.languageOffset ?? 0 }, visibleElapsed),
    right: scheduleScreen(snapshot, { ...config, languageOffset: (config.languageOffset ?? 0) + 1 }, visibleElapsed),
  });
}

export function hibiyaPanelStations(route: readonly StationDefinition[], panel: 0 | 1): readonly StationDefinition[] {
  return Object.freeze(route.slice(panel * PANEL_STATIONS, (panel + 1) * PANEL_STATIONS));
}

export function hibiyaRouteWindow(model: ScreenSchedule): readonly StationDefinition[] {
  const direction = model.line.directions.find(item => item.id === model.snapshot.direction);
  const ordered = direction?.delta === -1 ? [...model.line.stations].reverse() : [...model.line.stations];
  const currentIndex = ordered.findIndex(station => station.code === model.snapshot.station);
  if (currentIndex < 0) return Object.freeze(model.route.slice(0, PANEL_STATIONS * 2));
  const length = Math.min(PANEL_STATIONS * 2, ordered.length);
  const start = Math.max(0, Math.min(currentIndex - Math.floor(PANEL_STATIONS / 2), ordered.length - length));
  return Object.freeze(ordered.slice(start, start + length));
}

function stationAtHeader(model: ScreenSchedule): StationDefinition {
  return model.snapshot.state === 'approaching'
    ? model.nextStation ?? model.station : model.station;
}

function fontFamily(language: ScreenLanguage): string {
  return language === 'ja' || language === 'kana' || language === 'zh' ? 'Yu Gothic, Meiryo, sans-serif' : 'Arial, sans-serif';
}

function stationName(station: StationDefinition, language: ScreenLanguage): string {
  return station.names[language] ?? station.names.ja ?? station.names.en ?? station.code;
}

function drawHeader(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  const current = stationAtHeader(model);
  const direction = model.line.directions.find(item => item.id === model.snapshot.direction);
  ctx.fillStyle = C.header; ctx.fillRect(0, 0, HIBIYA_PANEL_WIDTH, 216);
  drawBadge(ctx, current.code, 34, 36, 70, C.route);
  drawFittedText(ctx, current.code, 124, 46, 150, 28, 20, C.ink, 700);
  drawFittedText(ctx, stationName(current, model.language), 124, 112, 820, 122, 94, C.ink, 700, fontFamily(model.language));
  drawFittedText(ctx, phrase(model.language, model.snapshot.state), 124, 174, 400, 32, 22, C.ink, 600, fontFamily(model.language));
  drawFittedText(ctx, localizedName(direction?.names ?? {}, model.language, model.destination), 542, 174, 500, 28, 18,
    C.ink, 600, fontFamily(model.language));
  ctx.fillStyle = C.ink; ctx.fillRect(1082, 24, 164, 168);
  drawFittedText(ctx, String(model.snapshot.remainingMinutes), 1164, 82, 132, 58, 38, C.white, 700, 'Arial, sans-serif', 'center');
  const minute = model.language === 'ja' ? '分' : model.language === 'kana' ? 'ふん' : model.language === 'zh' ? '分钟' : model.language === 'ko' ? '분' : 'min';
  drawFittedText(ctx, minute, 1164, 140, 132, 25, 18, C.white, 600, fontFamily(model.language), 'center');
}

function drawVerticalName(ctx: CanvasRenderingContext2D, station: StationDefinition, language: ScreenLanguage, x: number): void {
  const name = stationName(station, language);
  if (language !== 'ja' && language !== 'kana') {
    drawFittedText(ctx, name, x, 420, 136, 26, 16, C.ink, 700, fontFamily(language), 'center');
    return;
  }
  const chars = [...name];
  const size = Math.min(34, 186 / Math.max(1, chars.length));
  chars.forEach((char, index) => drawFittedText(ctx, char, x, 286 + index * size, 38, size, Math.max(16, size - 1),
    C.ink, 700, fontFamily(language), 'center'));
}

function drawConnections(ctx: CanvasRenderingContext2D, station: StationDefinition, language: ScreenLanguage, x: number): void {
  const names = station.transfers.map(item => item.kind === 'badge'
    ? item.code : localizedName(item.names, language, item.names.ja ?? item.names.en ?? ''));
  if (names.length) drawFittedText(ctx, names.join(' · '), x, 614, 136, 23, 14, C.ink, 600, fontFamily(language), 'center');
}

function drawRoutePanel(ctx: CanvasRenderingContext2D, model: ScreenSchedule, panel: 0 | 1): void {
  const route = hibiyaRouteWindow(model);
  const stations = hibiyaPanelStations(route, panel);
  ctx.fillStyle = C.body; ctx.fillRect(0, 216, HIBIYA_PANEL_WIDTH, 498);
  const slotWidth = 144;
  if (stations.length > 1) {
    ctx.strokeStyle = C.route; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(64 + slotWidth / 2, 512); ctx.lineTo(64 + slotWidth * (stations.length - 0.5), 512); ctx.stroke();
  }
  if (route.length > PANEL_STATIONS && panel === 0) {
    ctx.strokeStyle = C.route; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(64 + slotWidth * (PANEL_STATIONS - 0.5), 512); ctx.lineTo(HIBIYA_PANEL_WIDTH, 512); ctx.stroke();
  } else if (route.length > PANEL_STATIONS && panel === 1) {
    ctx.strokeStyle = C.route; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(0, 512); ctx.lineTo(64 + slotWidth / 2, 512); ctx.stroke();
  }
  const directionDelta = model.line.directions.find(item => item.id === model.snapshot.direction)?.delta ?? 1;
  const currentIndex = model.line.stations.findIndex(station => station.code === model.snapshot.station);
  const currentPosition = directionDelta > 0 ? currentIndex : model.line.stations.length - 1 - currentIndex;
  stations.forEach((station, index) => {
    const x = 64 + slotWidth * (index + 0.5);
    const current = station.code === model.snapshot.station;
    const next = station.code === model.snapshot.next;
    const stationIndex = model.line.stations.findIndex(item => item.code === station.code);
    const stationPosition = directionDelta > 0 ? stationIndex : model.line.stations.length - 1 - stationIndex;
    const past = stationPosition < currentPosition;
    drawVerticalName(ctx, station, model.language, x);
    ctx.fillStyle = current ? C.current : next ? C.next : past ? C.past : C.white;
    ctx.strokeStyle = C.route; ctx.lineWidth = current || next ? 5 : 3;
    ctx.beginPath(); ctx.arc(x, 512, current || next ? 34 : 27, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawFittedText(ctx, station.code, x, 512, 60, 18, 12, current ? C.white : C.ink, 700, 'Arial, sans-serif', 'center');
    drawConnections(ctx, station, model.language, x);
  });
  if (panel === 1) drawFittedText(ctx, `${model.snapshot.remainingMinutes} min`, 1180, 674, 180, 28, 18,
    C.ink, 700, 'Arial, sans-serif', 'right');
}

function drawNearbyRoute(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  const stations = model.nearby.slice(0, 5);
  ctx.fillStyle = C.body; ctx.fillRect(0, 216, HIBIYA_PANEL_WIDTH, 498);
  drawFittedText(ctx, phrase(model.language, 'nearby'), 64, 264, 640, 40, 28, C.ink, 700, fontFamily(model.language));
  const slotWidth = 222;
  if (stations.length > 1) {
    ctx.strokeStyle = C.route; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(82 + slotWidth / 2, 464); ctx.lineTo(82 + slotWidth * (stations.length - 0.5), 464); ctx.stroke();
  }
  stations.forEach((station, index) => {
    const x = 82 + slotWidth * (index + 0.5);
    const next = station.code === model.snapshot.next;
    ctx.fillStyle = next ? C.next : C.white; ctx.strokeStyle = C.route; ctx.lineWidth = next ? 6 : 3;
    ctx.beginPath(); ctx.arc(x, 464, next ? 42 : 32, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawFittedText(ctx, station.code, x, 464, 68, 20, 13, C.ink, 700, 'Arial, sans-serif', 'center');
    drawFittedText(ctx, stationName(station, model.language), x, 544, 200, 28, 18, C.ink, 700, fontFamily(model.language), 'center');
  });
}

function drawTransferDetail(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body; ctx.fillRect(0, 216, HIBIYA_PANEL_WIDTH, 498);
  drawFittedText(ctx, phrase(model.language, 'transfers'), 72, 276, 760, 42, 30, C.ink, 700, fontFamily(model.language));
  drawFittedText(ctx, `${model.station.code}  ${stationName(model.station, model.language)}`, 72, 342, 1120, 56, 40, C.ink, 700, fontFamily(model.language));
  model.transfers.slice(0, 5).forEach((transfer, index) => {
    const y = 424 + index * 54;
    if (/^[A-Z]{1,2}\d{1,2}$/.test(transfer)) {
      drawBadge(ctx, transfer, 88, y - 22, 44, C.route);
      return;
    }
    drawFittedText(ctx, transfer, 88, y, 1080, 32, 20, C.ink, 600, fontFamily(model.language));
  });
}

function drawPlatformGuidance(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  const station = model.snapshot.state === 'approaching'
    ? model.nextStation ?? model.station : model.station;
  ctx.fillStyle = C.body; ctx.fillRect(0, 216, HIBIYA_PANEL_WIDTH, 498);
  drawFittedText(ctx, `${phrase(model.language, 'platform')}  ${station.code}`, 64, 264, 1080, 42, 28, C.ink, 700, fontFamily(model.language));
  const order = station.platformByDirection[model.snapshot.direction]?.carOrder ?? Array.from({ length: 7 }, (_, index) => index + 1);
  const left = 56, gap = 8, top = 338, width = (1168 - 6 * gap) / 7;
  order.forEach((car, index) => {
    const x = left + index * (width + gap);
    ctx.fillStyle = car === 1 ? C.current : C.white; ctx.strokeStyle = C.route; ctx.lineWidth = 3;
    ctx.fillRect(x, top, width, 112); ctx.strokeRect(x + 1.5, top + 1.5, width - 3, 109);
    drawFittedText(ctx, String(car), x + width / 2, top + 56, width - 8, 30, 20,
      car === 1 ? C.white : C.ink, 700, 'Arial, sans-serif', 'center');
  });
}

function drawDoorGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, doors: string): void {
  const width = 260, height = 180, center = x + width / 2;
  ctx.fillStyle = C.white; ctx.fillRect(x, y, width, height);
  ctx.fillStyle = doors === 'open' ? '#c7d4dc' : '#a8b6bf';
  const gap = doors === 'open' ? 78 : 12;
  ctx.fillRect(x + 12, y + 12, width / 2 - gap / 2 - 12, height - 24);
  ctx.fillRect(center + gap / 2, y + 12, width / 2 - gap / 2 - 12, height - 24);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 4; ctx.strokeRect(x + 12, y + 12, width - 24, height - 24);
  ctx.beginPath(); ctx.moveTo(center, y + 12); ctx.lineTo(center, y + height - 12); ctx.stroke();
}

function drawDoorGuidance(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = '#fffbed'; ctx.fillRect(0, 216, HIBIYA_PANEL_WIDTH, 498);
  ctx.fillStyle = C.caution; ctx.fillRect(0, 216, HIBIYA_PANEL_WIDTH, 12);
  drawFittedText(ctx, phrase(model.language, 'doors'), 72, 286, 1000, 42, 30, C.ink, 700, fontFamily(model.language));
  const doorText = model.snapshot.state === 'approaching' ? phrase(model.language, 'approachingDoor')
    : phrase(model.language, model.snapshot.doors === 'open' ? 'open' : 'closed');
  drawFittedText(ctx, doorText, 72, 352, 1100, 38, 24, C.ink, 600, fontFamily(model.language));
  drawDoorGlyph(ctx, 112, 424, model.snapshot.doors);
  if (model.sideLabel && model.snapshot.state !== 'approaching') {
    const key = model.sideLabel === 'this side' ? 'thisSide' : model.sideLabel === 'opposite side' ? 'oppositeSide' : 'bothSides';
    drawFittedText(ctx, phrase(model.language, key), 472, 516, 640, 42, 28, C.ink, 700, fontFamily(model.language));
  }
}

function drawIncident(ctx: CanvasRenderingContext2D, model: ScreenSchedule, panel: 0 | 1): void {
  ctx.fillStyle = C.body; ctx.fillRect(0, 216, HIBIYA_PANEL_WIDTH, 498);
  ctx.fillStyle = C.caution; ctx.fillRect(0, 216, HIBIYA_PANEL_WIDTH, 10);
  if (panel === 0) {
    ctx.fillStyle = C.caution;
    ctx.beginPath(); ctx.moveTo(104, 310); ctx.lineTo(202, 480); ctx.lineTo(6, 480); ctx.closePath(); ctx.fill();
    drawFittedText(ctx, '!', 104, 420, 80, 90, 72, C.ink, 700, 'Arial, sans-serif', 'center');
    drawFittedText(ctx, phrase(model.language, model.snapshot.state), 264, 368, 920, 48, 32, C.ink, 700, fontFamily(model.language));
  } else {
    (['ja', 'en', 'zh', 'ko'] as const).forEach((language, index) => drawFittedText(ctx,
      phrase(language, model.snapshot.state), 88, 294 + index * 88, 1080, 42, 27, C.ink, 700, fontFamily(language)));
  }
}

function drawPanel(ctx: CanvasRenderingContext2D, model: ScreenSchedule, panel: 0 | 1): void {
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, HIBIYA_PANEL_WIDTH, HIBIYA_PANEL_HEIGHT); ctx.clip();
  ctx.fillStyle = C.body; ctx.fillRect(0, 0, HIBIYA_PANEL_WIDTH, HIBIYA_PANEL_HEIGHT);
  drawHeader(ctx, model);
  if (model.page === 'emergency' || model.page === 'suspension') drawIncident(ctx, model, panel);
  else if (model.page === 'platform' || model.page === 'closing') {
    if (panel === 0) drawPlatformGuidance(ctx, model);
    else drawDoorGuidance(ctx, model);
  } else if (model.page === 'broad') drawRoutePanel(ctx, model, panel);
  else if (model.page === 'transfers') {
    if (panel === 0) drawNearbyRoute(ctx, model);
    else drawTransferDetail(ctx, model);
  } else if (panel === 0) drawNearbyRoute(ctx, model);
  else if (model.transfers.length) drawTransferDetail(ctx, model);
  else drawDoorGuidance(ctx, model);
  ctx.restore();
}

function drawStaticPair(ctx: CanvasRenderingContext2D, pair: HibiyaPairSchedule): void {
  ctx.fillStyle = C.body; ctx.fillRect(0, 0, HIBIYA_LCD_WIDTH, HIBIYA_LCD_HEIGHT);
  drawPanel(ctx, pair.left, 0);
  ctx.save(); ctx.translate(HIBIYA_PANEL_WIDTH + HIBIYA_MULLION_WIDTH, 0); drawPanel(ctx, pair.right, 1); ctx.restore();
  ctx.fillStyle = '#101416'; ctx.fillRect(HIBIYA_PANEL_WIDTH, 0, HIBIYA_MULLION_WIDTH, HIBIYA_PANEL_HEIGHT);
}

export function createHibiyaRenderer() {
  const cache = new CanvasLayerCache(12);
  return {
    draw(ctx: CanvasRenderingContext2D, width: number, height: number, pair: HibiyaPairSchedule): void {
      const scale = Math.min(width / HIBIYA_LCD_WIDTH, height / HIBIYA_LCD_HEIGHT);
      const x = (width - HIBIYA_LCD_WIDTH * scale) / 2;
      const y = (height - HIBIYA_LCD_HEIGHT * scale) / 2;
      const key = `${pair.left.invalidationKey}|${pair.right.invalidationKey}`;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      const painted = cache.draw(ctx, key, HIBIYA_LCD_WIDTH, HIBIYA_LCD_HEIGHT, layer => drawStaticPair(layer, pair));
      if (!painted) drawStaticPair(ctx, pair);
      drawProgressBar(ctx, 0, HIBIYA_PANEL_HEIGHT - 6, HIBIYA_PANEL_WIDTH, pair.left.snapshot.progress, C.route);
      drawProgressBar(ctx, HIBIYA_PANEL_WIDTH + HIBIYA_MULLION_WIDTH, HIBIYA_PANEL_HEIGHT - 6,
        HIBIYA_PANEL_WIDTH, pair.right.snapshot.progress, C.route);
      ctx.fillStyle = '#101416'; ctx.fillRect(HIBIYA_PANEL_WIDTH, 0, HIBIYA_MULLION_WIDTH, HIBIYA_PANEL_HEIGHT);
      ctx.restore();
    },
    get cacheSize() { return cache.size; },
    dispose() { cache.clear(); },
  };
}

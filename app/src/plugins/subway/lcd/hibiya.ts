import { localizedName, type StationDefinition } from '../lines';
import { scheduleScreen, stationMinutes, type ScreenConfig, type ScreenLanguage, type ScreenSchedule } from '../screens';
import type { RunSnapshot } from '../run';
import { CanvasLayerCache, drawBadge, drawFittedText, JAPANESE_FONT } from './shared';

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
  const start = Math.max(0, Math.min(currentIndex - (PANEL_STATIONS - 1), ordered.length - length));
  return Object.freeze(ordered.slice(start, start + length));
}

function fontFamily(language: ScreenLanguage): string {
  return language === 'ja' || language === 'kana' || language === 'zh' ? JAPANESE_FONT : 'Arial, sans-serif';
}

function stationName(station: StationDefinition, language: ScreenLanguage): string {
  return station.names[language] ?? station.names.ja ?? station.names.en ?? station.code;
}

function drawHeader(ctx: CanvasRenderingContext2D, model: ScreenSchedule, panel: 0 | 1): void {
  const current = ['stopped', 'arriving'].includes(model.snapshot.state) ? model.station : model.nextStation ?? model.station;
  const destination = model.destination;
  const gradient = ctx.createLinearGradient(0, 0, 0, 216);
  gradient.addColorStop(0, '#d6d8d5'); gradient.addColorStop(.35, '#fafbf9'); gradient.addColorStop(1, '#e7e9e5');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1280, 216);
  const ja = model.language !== 'en';
  const caption = model.snapshot.state === 'approaching' ? (ja ? 'まもなく' : 'Arriving at') : model.snapshot.state === 'stopped' ? (ja ? 'ただいま' : 'Now at') : (ja ? 'つぎは' : 'Next');
  if (panel === 0) {
    ctx.fillStyle = '#626a69'; ctx.fillRect(22, 12, 252, 52);
    drawFittedText(ctx, ja ? '普通' : 'Local', 148, 38, 236, 32, 24, C.white, 700, JAPANESE_FONT, 'center');
    drawFittedText(ctx, caption, 1022, 46, 420, 34, 24, C.ink, 600, JAPANESE_FONT, 'right');
    drawBadge(ctx, current.code, 1074, 20, 176, C.route);
    drawFittedText(ctx, ja ? destination + ' ゆき' : 'For ' + destination, 28, 179, 480, 37, 24, C.ink);
    drawFittedText(ctx, stationName(current, model.language), 1036, 132, 900, 112, 54, C.ink, 700, fontFamily(model.language), 'right');
  } else {
    drawFittedText(ctx, caption, 28, 38, 680, 36, 24, C.ink);
    drawFittedText(ctx, stationName(current, model.language), 28, 130, 1080, 120, 56, C.ink, 700, fontFamily(model.language));
    drawFittedText(ctx, ja ? destination + ' ゆき' : 'For ' + destination, 1112, 182, 760, 34, 22, C.ink, 700, fontFamily(model.language), 'right');
    ctx.fillStyle = '#d5d9d5'; ctx.fillRect(1142, 14, 120, 188);
    drawFittedText(ctx, 'Car No.', 1202, 42, 110, 23, 18, C.ink, 500, 'Arial, sans-serif', 'center');
    drawFittedText(ctx, String(model.currentCar), 1202, 111, 110, 100, 66, C.ink, 600, 'Arial, sans-serif', 'center');
    drawFittedText(ctx, '号車', 1202, 179, 110, 26, 20, C.ink, 500, JAPANESE_FONT, 'center');
  }
  ctx.fillStyle = C.route; ctx.fillRect(0, 210, 1280, 6);
}

function drawRoutePanel(ctx: CanvasRenderingContext2D, model: ScreenSchedule, panel: 0 | 1): void {
  const route = [...hibiyaRouteWindow(model)].sort((a,b) => b.order-a.order), stations = hibiyaPanelStations(route, panel);
  ctx.fillStyle = C.body; ctx.fillRect(0, 216, 1280, 504);
  const rail = ctx.createLinearGradient(0, 480, 0, 536);
  rail.addColorStop(0, '#d9ddda'); rail.addColorStop(.48, '#929d9c'); rail.addColorStop(1, '#c6cbc6');
  ctx.fillStyle = rail; ctx.fillRect(0, 480, 1280, 56);
  const ordered = model.line.directions.find(d => d.id === model.snapshot.direction)?.delta === -1 ? [...model.line.stations].reverse() : model.line.stations;
  const currentPosition = ordered.findIndex(s => s.code === model.snapshot.station);
  stations.forEach((station, index) => {
    const x = 64 + 144 * (index + .5);
    const position = ordered.findIndex(s => s.code === station.code);
    const past = position < currentPosition;
    const language = model.language === 'kana' ? 'kana' : 'ja';
    ctx.save(); if (past) ctx.globalAlpha = .4;
    const name = stationName(station, language), step = Math.min(48, 214 / [...name].length);
    [...name].forEach((char, i) => drawFittedText(ctx, char, x, 240 + step * (i + .5), 64, step, 20, C.ink, 600, JAPANESE_FONT, 'center'));
    drawFittedText(ctx, station.code.replace(/([A-Z]+)(\d+)/, '$1-$2'), x, 464, 132, 25, 20, C.ink, 600, 'Arial, sans-serif', 'center');
    ctx.fillStyle = '#f9faf8'; ctx.fillRect(x - 40, 486, 80, 44);
    if (position > currentPosition) drawFittedText(ctx, String(stationMinutes(model, station.code) ?? ''), x, 508, 76, 39, 26, C.ink, 700, 'Arial, sans-serif', 'center');
    if (station.code === model.snapshot.station) {
      const arrow = model.line.directions.find(d=>d.id===model.snapshot.direction)?.delta === 1 ? -1 : 1;
      ctx.fillStyle = '#19539a'; ctx.beginPath(); ctx.moveTo(x - arrow*16, 480); ctx.lineTo(x + arrow*14, 508); ctx.lineTo(x - arrow*16, 536); ctx.lineTo(x, 508); ctx.closePath(); ctx.fill();
    }
    station.transfers.slice(0, 3).forEach((item, i) => {
      const text = item.kind === 'badge' ? item.code : localizedName(item.names, 'ja', item.names.en ?? '');
      ctx.fillStyle = ['#b44451', '#277a9a', '#938f30'][i]; ctx.beginPath(); ctx.arc(x - 60, 560 + i * 31, 8, 0, Math.PI * 2); ctx.fill();
      drawFittedText(ctx, text, x - 46, 560 + i * 31, 112, 22, 14, C.ink, 600);
    });
    ctx.restore();
  });
  if (panel === 1) drawFittedText(ctx, '運転状況により、多少時間は異なります。', 1240, 691, 1180, 24, 18, C.ink, 600, JAPANESE_FONT, 'right');
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
  drawFittedText(ctx, `${model.transferStation.code}  ${stationName(model.transferStation, model.language)}`, 72, 342, 1120, 56, 40, C.ink, 700, fontFamily(model.language));
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
  ctx.fillStyle = C.body; ctx.fillRect(0, 216, 1280, 504);
  const order = model.guidanceStation.platformByDirection[model.snapshot.direction]?.carOrder ?? [7, 6, 5, 4, 3, 2, 1];
  ctx.fillStyle = '#cbd1cf'; ctx.beginPath(); ctx.moveTo(76, 352); ctx.lineTo(138, 292); ctx.lineTo(1142, 292); ctx.lineTo(1204, 352); ctx.lineTo(1204, 532); ctx.lineTo(76, 532); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#9da8a7'; ctx.lineWidth = 5; ctx.stroke();
  ctx.fillStyle = C.route; ctx.fillRect(76, 524, 1128, 10);
  const facilities = model.guidanceStation.platformByDirection[model.snapshot.direction]?.facilities ?? [];
  facilities.forEach(f => {
    const x = 76 + (f.relativePosition ?? ((f.car ?? 1) - .5) / 7) * 1128;
    ctx.fillStyle = C.caution; ctx.fillRect(Math.max(16, x - 110), 274, 220, 44);
    drawFittedText(ctx, f.label, x, 296, 210, 24, 16, C.ink, 600, JAPANESE_FONT, 'center');
  });
  order.forEach((car, i) => {
    const x = 76 + i * 161;
    ctx.fillStyle = car === model.currentCar ? C.current : '#ebeeeb'; ctx.fillRect(x, 548, 157, 50);
    drawFittedText(ctx, String(car), x + 78, 573, 150, 40, 26, car === model.currentCar ? C.white : C.ink, 600, 'Arial, sans-serif', 'center');
  });
  drawFittedText(ctx, 'この電車は 7 両編成です', 48, 654, 1000, 32, 24, C.ink);
  drawFittedText(ctx, '7-car train', 48, 694, 1000, 23, 18, C.ink, 500, 'Arial, sans-serif');
}

function drawDoorGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, doors: string): void {
  const width = 804, height = 366, gap = doors === 'open' ? 166 : 8;
  ctx.fillStyle = '#e2e6e4'; ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = '#727b79'; ctx.lineWidth = 7; ctx.strokeRect(x, y, width, height);
  for (const side of [0, 1]) {
    const left = x + 16 + side * (width / 2 + gap / 2);
    const paneWidth = width / 2 - gap / 2 - 24;
    const metal = ctx.createLinearGradient(left, 0, left + paneWidth, 0);
    metal.addColorStop(0, '#aeb9bc'); metal.addColorStop(.5, '#d7dfe0'); metal.addColorStop(1, '#a6b0b4');
    ctx.fillStyle = metal; ctx.fillRect(left, y + 12, paneWidth, height - 24);
    ctx.fillStyle = '#7896a5'; ctx.fillRect(left + 36, y + 30, paneWidth - 72, 144);
    ctx.strokeStyle = '#edf4f1'; ctx.lineWidth = 4; ctx.strokeRect(left + 36, y + 30, paneWidth - 72, 144);
  }
}

function drawDoorGuidance(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body; ctx.fillRect(0, 216, 1280, 504);
  const closing = model.page === 'closing';
  const side = model.sideLabel === 'opposite side' ? '反対側' : model.sideLabel === 'both sides' ? '両側' : model.sideLabel ? 'こちら側' : '';
  const message = closing ? 'ドアが閉まります' : side ? side + 'のドアが開きます' : 'ドアにご注意ください';
  drawFittedText(ctx, message, 28, 243, 1220, 38, 26, C.ink);
  const english = closing ? 'Doors are closing.' : model.sideLabel === 'opposite side' ? 'Doors on the opposite side will open.'
    : model.sideLabel === 'both sides' ? 'Doors on both sides will open.' : model.sideLabel ? 'Doors on this side will open.' : 'Please take care around the doors.';
  drawFittedText(ctx, english, 28, 276, 1220, 24, 18, C.ink, 500, 'Arial, sans-serif');
  drawDoorGlyph(ctx, 238, 290, model.snapshot.doors);
  ctx.fillStyle = '#edcf28'; ctx.beginPath(); ctx.moveTo(640, 488); ctx.lineTo(682, 560); ctx.lineTo(598, 560); ctx.closePath(); ctx.fill();
  drawFittedText(ctx, '!', 640, 539, 50, 48, 34, C.ink, 700, 'Arial, sans-serif', 'center');
  ctx.fillStyle = C.caution; ctx.fillRect(0, 666, 1280, 54);
  drawFittedText(ctx, closing ? 'ドアが閉まります ご注意ください' : model.snapshot.doors === 'open' ? 'ドアが開いています ご注意ください' : 'ドアにご注意ください', 20, 692, 950, 30, 22, C.ink);
  drawFittedText(ctx, 'Caution', 1248, 692, 260, 30, 22, C.ink, 600, 'Arial, sans-serif', 'right');
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
  drawHeader(ctx, model, panel);
  if (model.page === 'emergency' || model.page === 'suspension') drawIncident(ctx, model, panel);
  else if (model.page === 'platform' || model.page === 'closing') {
    if (panel === 0) drawPlatformGuidance(ctx, model);
    else drawDoorGuidance(ctx, model);
  } else if (model.page === 'broad') drawRoutePanel(ctx, model, panel);
  else if (model.page === 'transfers') {
    if (panel === 0) drawNearbyRoute(ctx, model);
    else drawTransferDetail(ctx, model);
  } else if (panel === 0) drawRoutePanel(ctx, model, panel);
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
      ctx.fillStyle = '#101416'; ctx.fillRect(HIBIYA_PANEL_WIDTH, 0, HIBIYA_MULLION_WIDTH, HIBIYA_PANEL_HEIGHT);
      ctx.restore();
    },
    get cacheSize() { return cache.size; },
    dispose() { cache.clear(); },
  };
}

import type { StationDefinition } from '../lines';
import { scheduleScreen, stationMinutes, type ScreenConfig, type ScreenLanguage, type ScreenSchedule } from '../screens';
import type { RunSnapshot } from '../run';
import { CanvasLayerCache } from './shared';

export const HIBIYA_PANEL_WIDTH = 1280;
export const HIBIYA_PANEL_HEIGHT = 720;
export const HIBIYA_MULLION_WIDTH = 32;
export const HIBIYA_LCD_WIDTH = HIBIYA_PANEL_WIDTH * 2 + HIBIYA_MULLION_WIDTH;
export const HIBIYA_LCD_HEIGHT = HIBIYA_PANEL_HEIGHT;
const PANEL_STATIONS = 8;
const HEADER_BOTTOM = 242;
const JAPANESE_FONT = '"BIZ UDPGothic", "Yu Gothic UI", Meiryo, sans-serif';
const LATIN_FONT = 'Arial, Helvetica, sans-serif';
export const HIBIYA_FLIP_MS = 700;
const C = Object.freeze({
  ink: '#080908', route: '#afafa3', caution: '#efd02b', white: '#ffffff',
  current: '#ba2540', body: '#ffffff',
});

export interface HibiyaPairSchedule {
  readonly left: ScreenSchedule;
  readonly right: ScreenSchedule;
  readonly languageOffset: number;
}

// Linear motion, vertical compression and fading reproduce the tutorial's 0.7 s flip.
export function hibiyaLanguageFrame(languages: readonly ScreenLanguage[], elapsed: number, offset = 0) {
  const tick = Math.floor((elapsed + 1_000) / 5_000);
  const index = ((tick + offset) % languages.length + languages.length) % languages.length;
  const progress = tick === 0 ? 1 : Math.min(1, (elapsed - (tick * 5_000 - 1_000)) / HIBIYA_FLIP_MS);
  return {
    from: languages[(index - 1 + languages.length) % languages.length] ?? 'ja',
    to: languages[index] ?? 'ja', progress,
    animating: languages.length > 1 && progress < 1,
    deadline: languages.length < 2 ? null : progress < 1 ? tick * 5_000 - 300 : (tick + 1) * 5_000 - 1_000,
  };
}

function drawFittedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number,
  size: number, min: number, color: string, weight = 700, family = JAPANESE_FONT, align: CanvasTextAlign = 'left'): void {
  ctx.font = `${weight} ${size}px ${family}`;
  const fitted = Math.max(min, Math.min(size, size * width / Math.max(1, ctx.measureText(text).width)));
  ctx.font = `${weight} ${fitted}px ${family}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y, width);
}

function drawBadge(ctx: CanvasRenderingContext2D, code: string, x: number, y: number, size: number, color: string): void {
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.white; ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size * .39, 0, Math.PI * 2); ctx.fill();
  const parts = code.match(/^([A-Z]+)(\d+)$/);
  drawFittedText(ctx, parts?.[1] ?? code, x + size / 2, y + size * (parts ? .33 : .51), size * .7, size * .37, 8, C.ink, 700, LATIN_FONT, 'center');
  if (parts) drawFittedText(ctx, parts[2], x + size / 2, y + size * .67, size * .7, size * .41, 8, C.ink, 700, LATIN_FONT, 'center');
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
  const base = scheduleScreen(snapshot, config, visibleElapsed);
  const languages = [...base.languages];
  if (languages.includes('ja') && languages.includes('en') && !languages.includes('kana')) languages.splice(languages.indexOf('ja') + 1, 0, 'kana');
  const languageOffset = (Number.isSafeInteger(config.languageOffset) ? config.languageOffset! : 0) + Math.max(0, languages.indexOf('en'));
  const panel = (offset: number): ScreenSchedule => {
    const frame = hibiyaLanguageFrame(languages, visibleElapsed, offset);
    const model = scheduleScreen(snapshot, { ...config, languages: [frame.to], languageOffset: 0 }, visibleElapsed);
    const nextDeadline = model.pageDeadline === null ? frame.deadline : frame.deadline === null ? model.pageDeadline : Math.min(model.pageDeadline, frame.deadline);
    return Object.freeze({ ...model, languages: Object.freeze(languages), languageDeadline: frame.deadline, nextDeadline });
  };
  return Object.freeze({ left: panel(languageOffset), right: panel(languageOffset + 1), languageOffset });
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
  // The reference shows three passed stops before the next stop (H06..H21, next H09).
  const start = Math.max(0, Math.min(currentIndex - 2, ordered.length - length));
  return Object.freeze(ordered.slice(start, start + length));
}

function fontFamily(language: ScreenLanguage): string {
  return language === 'ja' || language === 'kana' || language === 'zh' ? JAPANESE_FONT : LATIN_FONT;
}

function stationName(station: StationDefinition, language: ScreenLanguage): string {
  return station.names[language] ?? station.names.ja ?? station.names.en ?? station.code;
}

function targetStation(model: ScreenSchedule): StationDefinition {
  return ['stopped', 'arriving', 'doorsClosing'].includes(model.snapshot.state) ? model.station : model.nextStation ?? model.station;
}

function destinationName(model: ScreenSchedule, language: ScreenLanguage): string {
  const direction = model.line.directions.find(d => d.id === model.snapshot.direction);
  const station = direction?.delta === -1 ? model.line.stations[0] : model.line.stations.at(-1)!;
  return stationName(station, language);
}

function drawHeader(ctx: CanvasRenderingContext2D, model: ScreenSchedule, panel: 0 | 1): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, 224);
  gradient.addColorStop(0, '#eeeede'); gradient.addColorStop(.22, '#cecdc8');
  gradient.addColorStop(.68, '#f6f6f3'); gradient.addColorStop(1, '#fefefd');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1280, 224);
  ctx.save(); ctx.globalAlpha = .045; ctx.strokeStyle = '#454a42'; ctx.lineWidth = 32;
  ctx.beginPath(); ctx.moveTo(12, 204); ctx.bezierCurveTo(210, 14, 300, 100, 226, 210);
  ctx.bezierCurveTo(170, 108, 140, 80, 12, 204); ctx.stroke(); ctx.restore();
  ctx.fillStyle = C.route; ctx.fillRect(0, 224, 1280, 16);
  ctx.fillStyle = '#d5d5cc'; ctx.fillRect(0, 240, 1280, 2);
  if (panel === 0) drawBadge(ctx, targetStation(model).code, 1044, 18, 226, C.route);
  else {
    ctx.fillStyle = '#cbccc5'; ctx.beginPath(); ctx.roundRect(1160, 16, 108, 196, 9); ctx.fill();
    ctx.strokeStyle = '#92958c'; ctx.lineWidth = 1; ctx.stroke();
    drawFittedText(ctx, 'Car No.', 1214, 48, 98, 32, 24, C.ink, 400, LATIN_FONT, 'center');
    drawFittedText(ctx, String(model.currentCar), 1214, 122, 98, 108, 66, C.ink, 700, LATIN_FONT, 'center');
    drawFittedText(ctx, '号車', 1214, 185, 98, 32, 20, C.ink, 500, JAPANESE_FONT, 'center');
  }
}

function drawHeaderText(ctx: CanvasRenderingContext2D, model: ScreenSchedule, panel: 0 | 1, language: ScreenLanguage): void {
  const current = targetStation(model), destination = destinationName(model, language);
  const japanese = language === 'ja' || language === 'kana';
  const caption = ['approaching', 'arriving'].includes(model.snapshot.state) ? (japanese ? 'まもなく' : language === 'en' ? 'Soon' : phrase(language, 'approaching'))
    : ['stopped', 'doorsClosing'].includes(model.snapshot.state) ? (japanese ? 'ただいま' : language === 'en' ? 'Now at' : phrase(language, 'stopped'))
    : japanese ? 'つぎは' : phrase(language, 'cruising');
  const name = stationName(current, language);
  if (panel === 0) {
    drawFittedText(ctx, caption, 1012, 57, 490, 62, 28, '#51524c', 700, fontFamily(language), 'right');
    drawFittedText(ctx, name, 1012, 156, 720, japanese ? 138 : 150, 54, C.ink, japanese ? 900 : 700, fontFamily(language), 'right');
    if (language === 'en') {
      drawFittedText(ctx, 'For', 18, 133, 340, 58, 28, '#30332d', 700, LATIN_FONT);
      drawFittedText(ctx, destination, 18, 190, 520, 58, 28, '#30332d', 700, LATIN_FONT);
    } else drawFittedText(ctx, destination + (japanese ? ' ゆき' : ''), 18, 195, 480, 52, 24, '#30332d', 700, fontFamily(language));
  } else {
    drawFittedText(ctx, caption, 30, 47, 900, 60, 26, '#30332d', 700, fontFamily(language));
    drawFittedText(ctx, language === 'ja' && [...name].length === 2 ? [...name].join('　') : name, 30, 146, 1110, 132, 54, C.ink, japanese ? 900 : 700, fontFamily(language));
    drawFittedText(ctx, (language === 'en' ? 'For ' : '') + destination + (japanese ? ' ゆき' : ''), 1140, 194, 580, 54, 24, '#30332d', 700, fontFamily(language), 'right');
  }
}

function drawRoutePanel(ctx: CanvasRenderingContext2D, model: ScreenSchedule, panel: 0 | 1): void {
  const stations = hibiyaPanelStations(hibiyaRouteWindow(model), panel);
  ctx.fillStyle = C.body; ctx.fillRect(0, HEADER_BOTTOM, 1280, 720 - HEADER_BOTTOM);
  const rail = ctx.createLinearGradient(0, 484, 0, 544);
  rail.addColorStop(0, '#b9b9b2'); rail.addColorStop(.45, '#d9d9d4'); rail.addColorStop(.49, '#a3a49c'); rail.addColorStop(1, '#b4b4ab');
  ctx.fillStyle = rail; ctx.fillRect(0, 484, 1280, 60);
  ctx.strokeStyle = '#97998c'; ctx.lineWidth = 2; ctx.strokeRect(0, 484, 1280, 60);
  const ordered = model.line.directions.find(d => d.id === model.snapshot.direction)?.delta === -1 ? [...model.line.stations].reverse() : model.line.stations;
  const currentPosition = ordered.findIndex(s => s.code === model.snapshot.station);
  stations.forEach((station, index) => {
    const x = 150 + 140 * index;
    const position = ordered.findIndex(s => s.code === station.code);
    const past = position < currentPosition;
    ctx.save(); if (past || station.code === model.snapshot.station) ctx.globalAlpha = .48;
    const name = [...stationName(station, 'ja')], size = name.length > 4 ? 40 : 50;
    const top = name.length > 3 ? 270 : 320, bottom = 434;
    name.forEach((char, i) => drawFittedText(ctx, char, x, top + (bottom - top) * i / Math.max(1, name.length - 1), 76, size, 26, C.ink, 700, JAPANESE_FONT, 'center'));
    drawFittedText(ctx, station.code.replace(/([A-Z]+)(\d+)/, '$1-$2'), x, 470, 132, 29, 20, C.ink, 700, LATIN_FONT, 'center');
    const box = ctx.createLinearGradient(0, 490, 0, 538); box.addColorStop(0, '#ffffff'); box.addColorStop(1, '#e5e5dd');
    ctx.fillStyle = box; ctx.fillRect(x - 36, 490, 72, 48);
    if (position > currentPosition) drawFittedText(ctx, String(stationMinutes(model, station.code) ?? ''), x, 515, 70, 54, 26, C.ink, 700, LATIN_FONT, 'center');
    routeTransfers(station).slice(0, 5).forEach((sign, i) => {
      drawTransferSymbol(ctx, sign, x - 65, 552 + i * 23, 20);
      drawFittedText(ctx, sign.ja, x - 40, 562 + i * 23, 150, 18, 13, C.ink, 600);
    });
    ctx.restore();
  });
  if (panel === 1) {
    drawFittedText(ctx, '(分)', 1226, 523, 50, 22, 18, C.white, 500);
    drawFittedText(ctx, '運転状況により、多少時間は異なります。', 1260, 695, 1180, 30, 18, C.ink, 500, JAPANESE_FONT, 'right');
  }
}

type TransferSign = { code: string; color: string; ja: string; en: string; square?: boolean };
const TRANSFERS: Record<string, TransferSign> = {
  G: { code: 'G', color: '#ed9200', ja: '銀座線', en: 'Ginza Line' },
  M: { code: 'M', color: '#df2534', ja: '丸ノ内線', en: 'Marunouchi Line' },
  C: { code: 'C', color: '#00a16b', ja: '千代田線', en: 'Chiyoda Line' },
  Y: { code: 'Y', color: '#b49a41', ja: '有楽町線', en: 'Yurakucho Line' },
  T: { code: 'T', color: '#00a3bf', ja: '東西線', en: 'Tozai Line' },
  Z: { code: 'Z', color: '#8e76b6', ja: '半蔵門線', en: 'Hanzomon Line' },
  A: { code: 'A', color: '#d45b78', ja: '都営浅草線', en: 'Toei Asakusa Line' },
  E: { code: 'E', color: '#b52962', ja: '都営大江戸線', en: 'Toei Oedo Line' },
  I: { code: 'I', color: '#006db0', ja: '都営三田線', en: 'Toei Mita Line' },
  S: { code: 'S', color: '#90b62d', ja: '都営新宿線', en: 'Toei Shinjuku Line' },
  TY: { code: 'TY', color: '#d93549', ja: '東急東横線', en: 'Tokyu Toyoko Line', square: true },
  JE: { code: 'JE', color: '#b92e4c', ja: 'JR京葉線', en: 'JR Keiyo Line', square: true },
  JJ: { code: 'JJ', color: '#21937b', ja: 'JR常磐線', en: 'JR Joban Line', square: true },
  TX: { code: 'TX', color: '#263642', ja: 'つくばエクスプレス', en: 'Tsukuba Express', square: true },
  TS: { code: 'TS', color: '#0089c4', ja: '東武スカイツリーライン', en: 'Tobu Skytree Line', square: true },
};

function routeTransfers(station: StationDefinition): TransferSign[] {
  return station.transfers.flatMap(item => {
    if (item.kind === 'badge') {
      const prefix = item.code.replace(/\d+$/, '');
      return [TRANSFERS[prefix] ?? { code: prefix, color: '#263642', ja: prefix, en: prefix, square: true }];
    }
    return (item.names.ja ?? item.names.en ?? '').split(/[・、,]/).filter(Boolean).map(ja =>
      ja.includes('つくば') ? TRANSFERS.TX : { code: ja.includes('JR') ? 'JR' : '', color: ja.includes('京成') ? '#277ca3' : '#2b7364', ja, en: item.names.en ?? ja, square: true });
  }).filter((item, index, list) => list.findIndex(sign => sign.ja === item.ja) === index);
}

function drawTransferSymbol(ctx: CanvasRenderingContext2D, sign: TransferSign, x: number, y: number, size: number): void {
  if (!sign.square) { drawBadge(ctx, sign.code, x, y, size, sign.color); return; }
  ctx.fillStyle = sign.color; ctx.fillRect(x, y, size, size);
  ctx.fillStyle = C.white; ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
  drawFittedText(ctx, sign.code || '↔', x + size / 2, y + size / 2, size - 3, size * .64, 8, sign.color, 700, LATIN_FONT, 'center');
}

function drawPosition(ctx: CanvasRenderingContext2D, model: ScreenSchedule, panel: 0 | 1, elapsed: number): void {
  const stations = hibiyaPanelStations(hibiyaRouteWindow(model), panel);
  const index = stations.findIndex(s => s.code === model.snapshot.station);
  if (index < 0) return;
  const stopped = !model.nextStation || ['stopped', 'arriving', 'doorsClosing'].includes(model.snapshot.state);
  const x = 150 + 140 * index + (stopped ? 0 : 70);
  ctx.save(); ctx.translate(panel * (HIBIYA_PANEL_WIDTH + HIBIYA_MULLION_WIDTH), 0);
  ctx.globalAlpha = stopped ? 1 : elapsed % 1_000 < 650 ? 1 : .2;
  ctx.strokeStyle = C.white; ctx.lineWidth = 5; ctx.fillStyle = '#1c5098';
  ctx.beginPath(); ctx.moveTo(x - 28, 484); ctx.lineTo(x + 4, 514); ctx.lineTo(x - 28, 544);
  ctx.lineTo(x - 2, 544); ctx.lineTo(x + 30, 514); ctx.lineTo(x - 2, 484); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}

function drawTransferDetail(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body; ctx.fillRect(0, HEADER_BOTTOM, HIBIYA_PANEL_WIDTH, 720 - HEADER_BOTTOM);
  ctx.fillStyle = '#e3e4de'; ctx.fillRect(0, HEADER_BOTTOM, HIBIYA_PANEL_WIDTH, 52);
  drawFittedText(ctx, 'のりかえのご案内 / Transfer information', 30, 268, 1220, 32, 24, C.ink, 500);
  routeTransfers(model.transferStation).slice(0, 5).forEach((sign, index) => {
    const y = 324 + index * 74;
    drawTransferSymbol(ctx, sign, 56, y, 52);
    drawFittedText(ctx, sign.ja, 132, y + 14, 1060, 36, 24, C.ink, 700);
    drawFittedText(ctx, sign.en, 132, y + 48, 1060, 28, 18, C.ink, 500, LATIN_FONT);
  });
}

function drawPlatformGuidance(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body; ctx.fillRect(0, HEADER_BOTTOM, 1280, 720 - HEADER_BOTTOM);
  const details = model.guidanceStation.platformByDirection[model.snapshot.direction];
  const order = details?.carOrder ?? [7, 6, 5, 4, 3, 2, 1];
  const row = ctx.createLinearGradient(0, 318, 0, 420); row.addColorStop(0, '#e5e6e1'); row.addColorStop(1, '#f7f8f4');
  ctx.fillStyle = row; ctx.fillRect(0, 318, 1280, 102);
  const x0 = 132, pitch = 144, trainY = 532;
  ctx.lineWidth = 3; ctx.strokeStyle = '#30332c';
  order.forEach((car, i) => {
    const x = x0 + i * pitch, current = car === model.currentCar;
    ctx.fillStyle = current ? C.current : '#f5f6f3';
    ctx.beginPath(); ctx.roundRect(x, trainY, pitch - 2, 42, i === 0 || i === order.length - 1 ? 9 : 0); ctx.fill(); ctx.stroke();
    drawFittedText(ctx, String(car), x + pitch / 2, trainY + 22, 130, 36, 24, current ? C.white : C.ink, 700, LATIN_FONT, 'center');
    if (current) {
      ctx.fillStyle = C.current; ctx.fillRect(x - 10, trainY - 96, pitch + 18, 65);
      drawFittedText(ctx, '現在地', x + pitch / 2, trainY - 75, pitch + 10, 32, 20, C.white, 700, JAPANESE_FONT, 'center');
      drawFittedText(ctx, 'You are here', x + pitch / 2, trainY - 45, pitch + 10, 21, 14, C.white, 700, LATIN_FONT, 'center');
      ctx.beginPath(); ctx.moveTo(x + 55, trainY - 29); ctx.lineTo(x + 88, trainY - 29); ctx.lineTo(x + 72, trainY - 5); ctx.fill();
    }
  });
  ctx.fillStyle = C.route; ctx.fillRect(x0, trainY + 44, pitch * order.length - 2, 9);
  // Only sourced facilities are placed; an empty station layout must not invent exits.
  for (const f of details?.facilities ?? []) {
    const position = f.relativePosition ?? Math.max(0, order.indexOf(f.car ?? 1) + .5) / order.length;
    const x = x0 + position * pitch * order.length;
    ctx.fillStyle = '#eabc45'; ctx.fillRect(Math.max(12, Math.min(1000, x - 120)), 340, 268, 50);
    drawFittedText(ctx, f.label, Math.max(146, Math.min(1134, x + 14)), 364, 254, 28, 17, C.ink, 600, JAPANESE_FONT, 'center');
    ctx.strokeStyle = '#30332c'; ctx.lineWidth = 4; ctx.beginPath();
    if (f.kind === 'stairs' || f.kind === 'escalator') {
      ctx.moveTo(x - 40, trainY); for (let j = 0; j < 5; j++) { ctx.lineTo(x - 40 + j * 14, trainY - (j + 1) * 13); ctx.lineTo(x - 26 + j * 14, trainY - (j + 1) * 13); } ctx.stroke();
    } else if (f.kind === 'lift') {
      ctx.strokeRect(x - 18, trainY - 74, 36, 74); drawFittedText(ctx, '↕', x, trainY - 40, 30, 38, 24, C.ink, 600, LATIN_FONT, 'center');
    }
  }
  routeTransfers(model.guidanceStation).slice(0, 4).forEach((sign, i) => {
    const x = 38 + (i % 2) * 600, y = 260 + Math.floor(i / 2) * 34;
    drawTransferSymbol(ctx, sign, x, y, 27);
    drawFittedText(ctx, sign.ja + ' / ' + sign.en, x + 36, y + 15, 540, 24, 16, C.ink, 500);
  });
  drawFittedText(ctx, '足元にご注意ください。', 800, 642, 540, 26, 18, '#a93a45', 500, JAPANESE_FONT, 'center');
  drawFittedText(ctx, 'この電車は ' + order.length + ' 両編成です。', 24, 694, 1100, 26, 18, C.ink, 500);
}

function drawDoorGlyph(ctx: CanvasRenderingContext2D, doors: string): void {
  const gap = doors === 'open' ? 130 : doors === 'opening' || doors === 'closing' ? 60 : 0;
  ctx.fillStyle = '#e3e5e1'; ctx.fillRect(406, 316, 468, 404);
  ctx.fillStyle = '#7f8787'; ctx.fillRect(622 - gap / 2, 316, gap + 36, 404);
  for (const side of [0, 1]) {
    const left = 418 + side * 222 + (side === 0 ? -gap / 2 : gap / 2);
    const metal = ctx.createLinearGradient(left, 0, left + 212, 0);
    metal.addColorStop(0, '#8c9394'); metal.addColorStop(.12, '#626b70'); metal.addColorStop(.86, '#555d62'); metal.addColorStop(1, '#aeb5b4');
    ctx.fillStyle = metal; ctx.fillRect(left, 316, 212, 404);
    ctx.strokeStyle = '#c4cbcb'; ctx.lineWidth = 4; ctx.strokeRect(left + 7, 320, 198, 400);
    ctx.fillStyle = '#dde4e2'; ctx.beginPath(); ctx.roundRect(left + 35, 342, 142, 210, 20); ctx.fill();
    ctx.strokeStyle = '#32393c'; ctx.lineWidth = 9; ctx.stroke();
    ctx.strokeStyle = '#eef2ef'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#d0d5d2'; ctx.fillRect(left + (side === 0 ? 193 : 12), 560, 5, 76);
  }
}

function doorArrow(ctx: CanvasRenderingContext2D, x: number, direction: number): void {
  ctx.save(); ctx.translate(x, 500); ctx.scale(direction, 1);
  const gradient = ctx.createLinearGradient(-96, 0, 96, 0);
  gradient.addColorStop(0, '#d27043'); gradient.addColorStop(.6, '#e18a52'); gradient.addColorStop(1, '#f0d4b5');
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(-96, 0); ctx.lineTo(0, -88); ctx.lineTo(0, -48);
  ctx.lineTo(112, -48); ctx.lineTo(112, 48); ctx.lineTo(0, 48); ctx.lineTo(0, 88); ctx.closePath(); ctx.fill(); ctx.restore();
}

function drawDoorGuidance(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = '#eef0eb'; ctx.fillRect(0, HEADER_BOTTOM, 1280, 720 - HEADER_BOTTOM);
  const closing = model.page === 'closing';
  const side = model.sideLabel === 'opposite side' ? '反対側' : model.sideLabel === 'both sides' ? '両側' : model.sideLabel ? 'こちら側' : '';
  const message = closing ? 'ドアが閉まります' : side ? side + 'のドアが開きます' : 'ドアにご注意ください';
  const english = closing ? 'Doors are closing.' : model.sideLabel === 'opposite side' ? 'Doors on the opposite side will open.'
    : model.sideLabel === 'both sides' ? 'Doors on both sides will open.' : model.sideLabel ? 'Doors on this side will open.' : 'Please take care around the doors.';
  drawFittedText(ctx, message + ' / ' + english, 12, 272, 1256, 38, 25, '#142432', 500);
  ctx.fillStyle = '#626a6b'; ctx.fillRect(0, 302, 1280, 2);
  const opposite = model.sideLabel === 'opposite side';
  drawDoorGlyph(ctx, opposite ? 'closed' : model.snapshot.doors);
  if (closing || model.sideLabel && !opposite) { doorArrow(ctx, 230, closing ? -1 : 1); doorArrow(ctx, 1050, closing ? 1 : -1); }
  if (closing || model.snapshot.doors === 'open') {
    ctx.fillStyle = C.caution; ctx.fillRect(0, 680, 1280, 40);
    drawFittedText(ctx, closing ? 'ドアが閉まります ご注意ください' : 'ドアにご注意ください', 20, 700, 950, 28, 22, C.ink, 500);
    drawFittedText(ctx, 'Caution', 1248, 700, 250, 28, 22, C.ink, 500, LATIN_FONT, 'right');
  }
}

function drawIncident(ctx: CanvasRenderingContext2D, model: ScreenSchedule, panel: 0 | 1): void {
  ctx.fillStyle = C.body; ctx.fillRect(0, HEADER_BOTTOM, HIBIYA_PANEL_WIDTH, 720 - HEADER_BOTTOM);
  ctx.fillStyle = C.caution; ctx.fillRect(0, HEADER_BOTTOM, HIBIYA_PANEL_WIDTH, 10);
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
  if (model.page === 'emergency' || model.page === 'suspension') drawIncident(ctx, model, panel);
  else if (model.page === 'platform' || model.page === 'closing') {
    if (panel === 0) drawPlatformGuidance(ctx, model);
    else drawDoorGuidance(ctx, model);
  } else if (model.page === 'broad' || model.page === 'nearby') drawRoutePanel(ctx, model, panel);
  else if (model.page === 'transfers') {
    if (panel === 0) drawRoutePanel(ctx, model, panel);
    else drawTransferDetail(ctx, model);
  }
  drawHeader(ctx, model, panel);
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
  let origin = 0, lastElapsed = -1, lastTime = 0;
  return {
    draw(ctx: CanvasRenderingContext2D, width: number, height: number, pair: HibiyaPairSchedule, time = pair.left.visibleElapsed): boolean {
      if (lastElapsed !== pair.left.visibleElapsed || time < lastTime) { origin = time; lastElapsed = pair.left.visibleElapsed; }
      lastTime = time;
      const elapsed = pair.left.visibleElapsed + Math.max(0, time - origin);
      const scale = Math.min(width / HIBIYA_LCD_WIDTH, height / HIBIYA_LCD_HEIGHT);
      const x = (width - HIBIYA_LCD_WIDTH * scale) / 2;
      const y = (height - HIBIYA_LCD_HEIGHT * scale) / 2;
      const key = `${pair.left.invalidationKey}|${pair.right.invalidationKey}`;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      const painted = cache.draw(ctx, key, HIBIYA_LCD_WIDTH, HIBIYA_LCD_HEIGHT, layer => drawStaticPair(layer, pair));
      if (!painted) drawStaticPair(ctx, pair);
      for (const panel of [0, 1] as const) {
        const model = panel === 0 ? pair.left : pair.right;
        const frame = hibiyaLanguageFrame(model.languages, elapsed, pair.languageOffset + panel);
        ctx.save(); ctx.translate(panel * (HIBIYA_PANEL_WIDTH + HIBIYA_MULLION_WIDTH), 0);
        ctx.beginPath(); ctx.rect(0, 0, panel === 0 ? 1040 : 1158, 224); ctx.clip();
        if (frame.animating) {
          ctx.save(); ctx.translate(0, 112 * frame.progress); ctx.translate(0, 112); ctx.scale(1, 1 - frame.progress); ctx.translate(0, -112);
          ctx.globalAlpha = 1 - frame.progress; drawHeaderText(ctx, model, panel, frame.from); ctx.restore();
          ctx.save(); ctx.translate(0, -112 / 3 * (1 - frame.progress)); ctx.translate(0, 112); ctx.scale(1, (2 + frame.progress) / 3); ctx.translate(0, -112);
          ctx.globalAlpha = frame.progress; drawHeaderText(ctx, model, panel, frame.to); ctx.restore();
        } else drawHeaderText(ctx, model, panel, frame.to);
        ctx.restore();
        if (model.page === 'broad' || model.page === 'nearby' || panel === 0 && model.page === 'transfers') drawPosition(ctx, model, panel, elapsed);
      }
      ctx.fillStyle = '#101416'; ctx.fillRect(HIBIYA_PANEL_WIDTH, 0, HIBIYA_MULLION_WIDTH, HIBIYA_PANEL_HEIGHT);
      ctx.restore();
      // Keep the visible clock moving between flips; SceneScheduler suspends hidden/frozen scenes.
      return pair.left.languages.length > 1 || ['broad', 'nearby'].includes(pair.left.page);
    },
    get cacheSize() { return cache.size; },
    dispose() { cache.clear(); },
  };
}

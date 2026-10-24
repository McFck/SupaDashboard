import { localizedName, type StationDefinition } from '../lines';
import type { ScreenLanguage, ScreenSchedule } from '../screens';
import { CanvasLayerCache, drawBadge, drawFittedText, drawProgressBar } from './shared';

export const SAKAISUJI_LCD_WIDTH = 1920;
export const SAKAISUJI_LCD_HEIGHT = 540;
export const SAKAISUJI_HEADER_HEIGHT = 108;
export const SAKAISUJI_COLORS = Object.freeze({
  header: '#744020', route: '#bc782d', next: '#d8e590', white: '#fbfcfc', ink: '#23292c',
  past: '#b9bec0', body: '#f8f7f4', dark: '#4d2918', caution: '#efd83d',
});

const C = SAKAISUJI_COLORS;
const CAR_ORDER = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);

export function sakaisujiLayout() {
  return Object.freeze({ width: SAKAISUJI_LCD_WIDTH, height: SAKAISUJI_LCD_HEIGHT,
    header: { x: 0, y: 0, width: SAKAISUJI_LCD_WIDTH, height: SAKAISUJI_HEADER_HEIGHT },
    body: { x: 0, y: SAKAISUJI_HEADER_HEIGHT, width: SAKAISUJI_LCD_WIDTH, height: SAKAISUJI_LCD_HEIGHT - SAKAISUJI_HEADER_HEIGHT },
  });
}

export function sakaisujiOrderedStations(model: ScreenSchedule): readonly StationDefinition[] {
  const direction = model.line.directions.find(item => item.id === model.snapshot.direction);
  return Object.freeze(direction?.delta === -1 ? [...model.line.stations].reverse() : [...model.line.stations]);
}

export function sakaisujiNearbyStations(model: ScreenSchedule): readonly StationDefinition[] {
  const ordered = sakaisujiOrderedStations(model);
  const current = ordered.findIndex(station => station.code === model.snapshot.station);
  if (current < 0) return Object.freeze([]);
  const count = Math.min(6, ordered.length);
  const start = Math.max(0, Math.min(current - 1, ordered.length - count));
  return Object.freeze(ordered.slice(start, start + count));
}

export function sakaisujiCarOrder(model: ScreenSchedule): readonly number[] {
  const supplied = model.station.platformByDirection[model.snapshot.direction]?.carOrder;
  return supplied?.length === 8 ? supplied : CAR_ORDER;
}

function fontFamily(language: ScreenLanguage): string {
  return language === 'ja' || language === 'kana' ? 'Yu Gothic, Meiryo, sans-serif' : 'Arial, sans-serif';
}

function nameOf(station: StationDefinition, language: ScreenLanguage): string {
  return station.names[language] ?? station.names.ja ?? station.code;
}

function displayDestination(model: ScreenSchedule): string {
  const terminal = sakaisujiOrderedStations(model).at(-1);
  if (!terminal) return model.destination;
  const name = nameOf(terminal, model.language);
  return `${name}${model.language === 'kana' ? 'ほうめん' : '方面'}`;
}

function stateLabel(model: ScreenSchedule): string {
  const labels: Record<string, Partial<Record<ScreenLanguage, string>>> = {
    stopped: { ja: '停車中', kana: 'ていしゃちゅう' },
    doorsClosing: { ja: 'ドアが閉まります', kana: 'ドアがしまります' },
    departing: { ja: '発車します', kana: 'はっしゃします' },
    cruising: { ja: '次は', kana: 'つぎは' },
    approaching: { ja: 'まもなく', kana: 'まもなく' },
    arriving: { ja: '到着', kana: 'とうちゃく' },
    emergency: { ja: '緊急停止', kana: 'きんきゅうていし' },
    suspended: { ja: '運転見合わせ', kana: 'うんてんみあわせ' },
  };
  return labels[model.snapshot.state]?.[model.language] ?? labels[model.snapshot.state]?.ja ?? '';
}

function fillRounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, height / 2);
  ctx.fill();
}

function drawHeader(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  const next = model.nextStation ?? model.station;
  ctx.fillStyle = C.header;
  ctx.fillRect(0, 0, SAKAISUJI_LCD_WIDTH, SAKAISUJI_HEADER_HEIGHT);
  fillRounded(ctx, 28, 17, 190, 74, C.dark);
  drawFittedText(ctx, model.language === 'kana' ? 'ふつう' : '普通', 123, 54, 170, 38, 28, C.white, 700, fontFamily(model.language), 'center');
  drawFittedText(ctx, displayDestination(model), 256, 52, 1030, 56, 52, C.white, 700, fontFamily(model.language));
  drawFittedText(ctx, stateLabel(model), 256, 86, 920, 27, 22, '#eadfd7', 600, fontFamily(model.language));
  fillRounded(ctx, 1480, 15, 412, 78, C.next);
  drawBadge(ctx, next.code, 1497, 29, 48, C.route);
  drawFittedText(ctx, nameOf(next, model.language), 1564, 43, 310, 38, 24, C.ink, 700, fontFamily(model.language));
}

function drawVerticalName(ctx: CanvasRenderingContext2D, station: StationDefinition, language: ScreenLanguage, x: number,
  y = 150, size = 46, maxHeight = 166): void {
  const name = nameOf(station, language);
  if (language !== 'ja' && language !== 'kana') {
    drawFittedText(ctx, name, x, y + maxHeight / 2, 152, 24, 15, C.ink, 700, fontFamily(language), 'center');
    return;
  }
  const chars = [...name];
  const charHeight = Math.min(size, maxHeight / Math.max(1, chars.length));
  chars.forEach((char, index) => drawFittedText(ctx, char, x, y + charHeight * (index + 0.5), 54,
    charHeight, Math.min(20, charHeight), C.ink, 700, fontFamily(language), 'center'));
}

function drawTransfers(ctx: CanvasRenderingContext2D, station: StationDefinition, language: ScreenLanguage, x: number, y: number): void {
  const transfers = station.transfers.slice(0, 3);
  if (!transfers.length) return;
  let offset = 0;
  for (const transfer of transfers) {
    if (transfer.kind === 'badge') {
      drawBadge(ctx, transfer.code, x - 18 + offset, y - 13, 36, C.route);
      offset += 40;
    } else {
      const text = localizedName(transfer.names, language, transfer.names.ja ?? transfer.names.en ?? '');
      drawFittedText(ctx, text, x, y + offset, 164, 18, 12, C.ink, 600, fontFamily(language), 'center');
      offset += 20;
    }
  }
}

function drawBroad(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body; ctx.fillRect(0, SAKAISUJI_HEADER_HEIGHT, SAKAISUJI_LCD_WIDTH, SAKAISUJI_LCD_HEIGHT - SAKAISUJI_HEADER_HEIGHT);
  const stations = sakaisujiOrderedStations(model);
  const currentIndex = stations.findIndex(station => station.code === model.snapshot.station);
  const nextIndex = stations.findIndex(station => station.code === model.snapshot.next);
  const left = 104, gap = 190, y = 370;
  ctx.strokeStyle = C.route; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + gap * (stations.length - 1), y); ctx.stroke();
  stations.forEach((station, index) => {
    const x = left + gap * index;
    const past = index < currentIndex;
    drawVerticalName(ctx, station, model.language, x, 144, 40, 170);
    const fill = index === currentIndex ? C.header : index === nextIndex ? C.next : past ? C.past : C.white;
    ctx.fillStyle = fill; ctx.strokeStyle = C.route; ctx.lineWidth = index === currentIndex || index === nextIndex ? 6 : 3;
    ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawFittedText(ctx, station.code, x, y, 62, 18, 13, index === currentIndex ? C.white : C.ink, 700, 'Arial, sans-serif', 'center');
    drawTransfers(ctx, station, model.language, x, 430);
  });
  drawDirectionArrow(ctx, 1848, y, 1);
  drawFittedText(ctx, `${model.snapshot.remainingMinutes} min`, 1848, 496, 140, 28, 20, C.ink, 700, 'Arial, sans-serif', 'right');
}

function drawNearby(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body; ctx.fillRect(0, SAKAISUJI_HEADER_HEIGHT, SAKAISUJI_LCD_WIDTH, SAKAISUJI_LCD_HEIGHT - SAKAISUJI_HEADER_HEIGHT);
  const stations = sakaisujiNearbyStations(model);
  const ordered = sakaisujiOrderedStations(model);
  const currentIndex = ordered.findIndex(station => station.code === model.snapshot.station);
  const left = 160, gap = 320, y = 360;
  drawFittedText(ctx, model.language === 'kana' ? 'ちかくのえき' : '近くの駅', 78, 145, 400, 30, 22, C.ink, 700, fontFamily(model.language));
  ctx.strokeStyle = C.route; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + gap * (stations.length - 1), y); ctx.stroke();
  stations.forEach((station, index) => {
    const x = left + gap * index;
    const current = station.code === model.snapshot.station;
    const next = station.code === model.snapshot.next;
    const past = !current && !next && ordered.findIndex(item => item.code === station.code) < currentIndex;
    drawVerticalName(ctx, station, model.language, x, 164, 42, 162);
    ctx.fillStyle = current ? C.header : next ? C.next : past ? C.past : C.white;
    ctx.strokeStyle = C.route; ctx.lineWidth = current || next ? 6 : 3;
    ctx.beginPath(); ctx.arc(x, y, current || next ? 38 : 31, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawFittedText(ctx, station.code, x, y, 70, 18, 13, current ? C.white : C.ink, 700, 'Arial, sans-serif', 'center');
    drawTransfers(ctx, station, model.language, x, 426);
  });
  drawDirectionArrow(ctx, 1838, y, 1);
  drawFittedText(ctx, `${model.snapshot.remainingMinutes} min`, 1848, 496, 140, 28, 20, C.ink, 700, 'Arial, sans-serif', 'right');
}

function drawDirectionArrow(ctx: CanvasRenderingContext2D, x: number, y: number, direction: 1 | -1): void {
  ctx.strokeStyle = C.route; ctx.fillStyle = C.route; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(x - direction * 18, y); ctx.lineTo(x + direction * 18, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + direction * 30, y); ctx.lineTo(x + direction * 12, y - 13); ctx.lineTo(x + direction * 12, y + 13); ctx.closePath(); ctx.fill();
}

function drawDoorGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, doors: string): void {
  ctx.fillStyle = C.white; ctx.fillRect(x, y, width, height);
  const center = x + width / 2, gap = doors === 'open' ? width * 0.24 : 8;
  ctx.fillStyle = '#c9b8a8';
  ctx.fillRect(x + 12, y + 12, width / 2 - gap / 2 - 12, height - 24);
  ctx.fillRect(center + gap / 2, y + 12, width / 2 - gap / 2 - 12, height - 24);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 4; ctx.strokeRect(x + 12, y + 12, width - 24, height - 24);
  ctx.beginPath(); ctx.moveTo(center, y + 12); ctx.lineTo(center, y + height - 12); ctx.stroke();
}

function drawPlatform(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  const station = model.snapshot.state === 'approaching' ? model.nextStation ?? model.station : model.station;
  ctx.fillStyle = C.body; ctx.fillRect(0, SAKAISUJI_HEADER_HEIGHT, SAKAISUJI_LCD_WIDTH, SAKAISUJI_LCD_HEIGHT - SAKAISUJI_HEADER_HEIGHT);
  drawFittedText(ctx, `${station.code}  ${nameOf(station, model.language)}`, 72, 148, 1760, 50, 36, C.ink, 700, fontFamily(model.language));
  const cars = sakaisujiCarOrder(model);
  const left = 78, top = 230, gap = 12, width = (1764 - gap * 7) / 8;
  cars.forEach((car, index) => {
    const x = left + index * (width + gap);
    ctx.fillStyle = car === 1 ? C.header : C.white; ctx.strokeStyle = C.route; ctx.lineWidth = 3;
    ctx.fillRect(x, top, width, 82); ctx.strokeRect(x + 1.5, top + 1.5, width - 3, 79);
    drawFittedText(ctx, String(car), x + width / 2, top + 41, width - 8, 28, 18,
      car === 1 ? C.white : C.ink, 700, 'Arial, sans-serif', 'center');
  });
  ctx.fillStyle = '#f2eadf'; ctx.fillRect(0, 354, SAKAISUJI_LCD_WIDTH, 180);
  fillRounded(ctx, 68, 374, 174, 44, C.next);
  const sideText = model.snapshot.state === 'approaching' || !model.sideLabel
    ? model.language === 'kana' ? 'どあ' : 'ドア'
    : model.sideLabel === 'this side' ? model.language === 'kana' ? 'こちらがわ' : 'こちら側'
      : model.sideLabel === 'opposite side' ? model.language === 'kana' ? 'はんたいがわ' : '反対側'
        : model.language === 'kana' ? 'りょうがわ' : '両側';
  drawFittedText(ctx, sideText, 155, 396, 150, 28, 19, C.ink, 700, fontFamily(model.language), 'center');
  drawDoorGlyph(ctx, 296, 370, 206, 144, model.snapshot.doors);
  const doorState = model.snapshot.state === 'approaching' ? '停車後にドアが開きます'
    : model.snapshot.doors === 'open' ? 'ドアが開いています' : 'ドアが閉まっています';
  const kanaDoorState = model.snapshot.state === 'approaching' ? 'ていしゃごにドアがあきます'
    : model.snapshot.doors === 'open' ? 'ドアがあいています' : 'ドアがしまっています';
  drawFittedText(ctx, model.language === 'kana' ? kanaDoorState : doorState, 548, 432, 980, 34, 24, C.ink, 600, fontFamily(model.language));
}

function drawTransferDetail(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body; ctx.fillRect(0, SAKAISUJI_HEADER_HEIGHT, SAKAISUJI_LCD_WIDTH, SAKAISUJI_LCD_HEIGHT - SAKAISUJI_HEADER_HEIGHT);
  drawFittedText(ctx, model.language === 'kana' ? 'のりかえあんない' : '乗り換え案内', 80, 162, 800, 42, 30, C.ink, 700, fontFamily(model.language));
  drawFittedText(ctx, `${model.station.code}  ${nameOf(model.station, model.language)}`, 80, 224, 1100, 56, 42, C.ink, 700, fontFamily(model.language));
  model.transfers.slice(0, 8).forEach((transfer, index) => {
    const x = 112 + (index % 4) * 440, y = 332 + Math.floor(index / 4) * 98;
    if (/^[A-Z]{1,3}\d{2}$/.test(transfer)) drawBadge(ctx, transfer, x, y - 25, 52, C.route);
    else drawFittedText(ctx, transfer, x + 76, y, 332, 32, 20, C.ink, 700, fontFamily(model.language));
  });
}

function drawIncident(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body; ctx.fillRect(0, SAKAISUJI_HEADER_HEIGHT, SAKAISUJI_LCD_WIDTH, SAKAISUJI_LCD_HEIGHT - SAKAISUJI_HEADER_HEIGHT);
  ctx.fillStyle = C.caution; ctx.fillRect(0, SAKAISUJI_HEADER_HEIGHT, SAKAISUJI_LCD_WIDTH, 8);
  ctx.fillStyle = C.dark; ctx.beginPath(); ctx.moveTo(154, 190); ctx.lineTo(258, 408); ctx.lineTo(50, 408); ctx.closePath(); ctx.fill();
  drawFittedText(ctx, '!', 154, 342, 94, 92, 76, C.white, 700, 'Arial, sans-serif', 'center');
  const messages = model.page === 'emergency'
    ? ['緊急停止', 'Emergency stop'] : ['運転見合わせ', 'Service suspended'];
  messages.forEach((message, index) => drawFittedText(ctx, message, 340, 238 + index * 86, 1280, 56, 38,
    index ? C.ink : C.header, 700, index ? 'Arial, sans-serif' : 'Yu Gothic, Meiryo, sans-serif'));
}

function drawStatic(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body; ctx.fillRect(0, 0, SAKAISUJI_LCD_WIDTH, SAKAISUJI_LCD_HEIGHT);
  drawHeader(ctx, model);
  if (model.page === 'emergency' || model.page === 'suspension') drawIncident(ctx, model);
  else if (model.page === 'platform' || model.page === 'closing') drawPlatform(ctx, model);
  else if (model.page === 'transfers') drawTransferDetail(ctx, model);
  else if (model.page === 'nearby') drawNearby(ctx, model);
  else drawBroad(ctx, model);
}

export function createSakaisujiRenderer() {
  const cache = new CanvasLayerCache(12);
  return {
    draw(ctx: CanvasRenderingContext2D, width: number, height: number, model: ScreenSchedule): void {
      const scale = Math.min(width / SAKAISUJI_LCD_WIDTH, height / SAKAISUJI_LCD_HEIGHT);
      const x = (width - SAKAISUJI_LCD_WIDTH * scale) / 2;
      const y = (height - SAKAISUJI_LCD_HEIGHT * scale) / 2;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      const painted = cache.draw(ctx, model.invalidationKey, SAKAISUJI_LCD_WIDTH, SAKAISUJI_LCD_HEIGHT,
        layer => drawStatic(layer, model));
      if (!painted) drawStatic(ctx, model);
      drawProgressBar(ctx, 0, SAKAISUJI_LCD_HEIGHT - 6, SAKAISUJI_LCD_WIDTH, model.snapshot.progress, C.route);
      ctx.restore();
    },
    get cacheSize() { return cache.size; },
    dispose() { cache.clear(); },
  };
}

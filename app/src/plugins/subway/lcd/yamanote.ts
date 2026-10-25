import type { ScreenSchedule } from '../screens';
import { drawLineSymbol, transferSigns } from './transfers';
import { drawE235Detailed, drawE235Header, drawE235Overlay, drawE235RouteMap, E235_WIDTH } from './e235';
import { CanvasLayerCache, drawBadge, drawFittedText, drawStationName, E235_COLORS as C, JAPANESE_FONT } from './shared';

export const YAMANOTE_LCD_WIDTH = 1280;
export const YAMANOTE_LCD_HEIGHT = 720;

export function yamanoteLayout() {
  return Object.freeze({
    width: 1280, height: 720, header: { x: 0, y: 0, width: 1280, height: 216 },
    direction: { x: 0, y: 0, width: 346, height: 216 }, separator: { x: 346, y: 0, width: 22, height: 216 },
    main: { x: 382, y: 0, width: 738, height: 216 }, body: { x: 0, y: 216, width: 1280, height: 504 },
    doorPanel: { x: 0, y: 520, width: 1280, height: 200 },
  });
}

export const isTransferBadge = (value: string) => /^[A-Z]{1,2}\d{1,2}$/.test(value);

export function yamanoteBroadNodePositions(count: number, directionDelta: 1 | -1) {
  if (!Number.isInteger(count) || count < 1) return [];
  const half = Math.ceil(count / 2);
  return Array.from({ length: count }, (_, index) => {
    const top = index < half;
    const offset = top ? index : count - index - 1;
    const x = 140 + offset * 1000 / Math.max(1, half - 1);
    return { x: directionDelta === 1 ? x : 1280 - x, y: top ? 418 : 530 };
  });
}

const MAJOR = new Set(['JY01', 'JY05', 'JY13', 'JY17', 'JY20', 'JY25']);
const HEADER_BG = '#26292a';
const BODY_BG = '#e9ebea';
const YELLOW = '#f5c518';
const TRAIN_RED = '#c8202f';

/** The station the header and map point at: the stop while standing, otherwise the next stop. */
function targetStation(model: ScreenSchedule) {
  return ['stopped', 'arriving'].includes(model.snapshot.state) ? model.station : model.nextStation ?? model.station;
}

/** E235 numbering badge: green frame, white face, line code over number; optional three-letter code tab above. */
function drawNumbering(ctx: CanvasRenderingContext2D, code: string, abbr: string | undefined, x: number, y: number, size: number) {
  if (abbr) {
    ctx.fillStyle = '#3a3e40'; ctx.beginPath(); ctx.roundRect(x - 6, y - size * .34, size + 12, size * 1.4, 10); ctx.fill();
    drawFittedText(ctx, abbr, x + size / 2, y - size * .17, size, size * .26, 12, C.white, 700, 'Arial, sans-serif', 'center');
  }
  ctx.fillStyle = C.route; ctx.beginPath(); ctx.roundRect(x, y, size, size, size * .1); ctx.fill();
  ctx.fillStyle = C.white; ctx.beginPath(); ctx.roundRect(x + size * .12, y + size * .12, size * .76, size * .76, size * .05); ctx.fill();
  const parts = code.match(/^([A-Z]+)(\d+)$/);
  drawFittedText(ctx, parts?.[1] ?? code, x + size / 2, y + size * .37, size * .6, size * .3, 10, '#1d2124', 700, 'Arial, sans-serif', 'center');
  if (parts) drawFittedText(ctx, parts[2], x + size / 2, y + size * .65, size * .66, size * .36, 10, '#1d2124', 700, 'Arial, sans-serif', 'center');
}

function header(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const ja = model.language !== 'en';
  const current = targetStation(model);
  const direction = model.line.directions.find(item => item.id === model.snapshot.direction);
  const landmarks = model.route.slice(1).filter(s => MAJOR.has(s.code) && s.code !== current.code).slice(0, 2);
  const termini = landmarks.map(s => s.names[model.language] ?? s.names.ja);
  ctx.fillStyle = HEADER_BG; ctx.fillRect(0, 0, 1280, 216);
  ctx.fillStyle = C.route; ctx.fillRect(318, 0, 42, 200);
  if (ja) {
    drawFittedText(ctx, termini.join('・') || direction?.names.ja || '', 300, 118, 280, 50, 26, C.white, 700, JAPANESE_FONT, 'right');
    drawFittedText(ctx, '方面', 300, 174, 120, 26, 18, C.white, 500, JAPANESE_FONT, 'right');
  } else {
    drawFittedText(ctx, 'Bound for', 22, 62, 280, 25, 18, '#d6dadc', 500, 'Arial, sans-serif');
    const lines = termini.length > 1 ? [termini[0] + '&', termini[1]] : [termini[0] ?? direction?.names.en ?? ''];
    lines.forEach((text, i) => drawFittedText(ctx, text, 22, 108 + i * 46, 286, 40, 22, C.white, 700, 'Arial, sans-serif'));
  }
  const state = model.snapshot.state;
  const caption = state === 'stopped' || state === 'arriving' ? (ja ? 'ただいま' : 'Now stopping at')
    : state === 'approaching' ? (ja ? 'まもなく' : 'Arriving at') : (ja ? 'つぎは' : 'Next');
  drawFittedText(ctx, caption, 384, 34, 560, 32, 22, C.white, 700, ja ? JAPANESE_FONT : 'Arial, sans-serif');
  drawFittedText(ctx, model.clock, 1130, 38, 160, 36, 24, C.white, 500, 'Arial, sans-serif', 'right');
  if (ja) {
    drawFittedText(ctx, String(model.currentCar), 1236, 30, 70, 40, 28, C.white, 500, 'Arial, sans-serif', 'center');
    drawFittedText(ctx, '号車', 1236, 62, 70, 17, 13, C.white, 500, JAPANESE_FONT, 'center');
  } else {
    drawFittedText(ctx, 'Car No.', 1212, 30, 80, 15, 12, '#d6dadc', 500, 'Arial, sans-serif', 'right');
    drawFittedText(ctx, String(model.currentCar), 1240, 40, 60, 46, 30, C.white, 500, 'Arial, sans-serif', 'center');
  }
  drawNumbering(ctx, current.code, ja ? undefined : current.abbr, 392, ja ? 84 : 98, 104);
  drawStationName(ctx, current, model.language, 528, ja ? 146 : 136, 1280 - 528 - 28, ja ? 120 : 132, 56, C.white);
}

function vertical(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, height: number, size: number, weight = 600, alignBottom = false) {
  // Vertical writing turns the long-vowel mark; names longer than five characters wrap into a second column.
  const chars = [...text.replace(/ー/g, '丨')];
  const columns = chars.length > 5 ? [chars.slice(0, Math.min(2, Math.ceil(chars.length / 2))), chars.slice(Math.min(2, Math.ceil(chars.length / 2)))] : [chars];
  const longest = Math.max(...columns.map(column => column.length));
  const step = Math.min(columns.length > 1 ? size * .78 : size, height / Math.max(1, longest));
  columns.forEach((column, c) => {
    const cx = columns.length > 1 ? x + (c ? -step * .55 : step * .55) : x;
    const start = alignBottom ? y + height - step * column.length : y;
    column.forEach((char, i) => drawFittedText(ctx, char, cx, start + step * (i + .5), 60, step, 10, '#1d2124', weight, JAPANESE_FONT, 'center'));
  });
}

/** Fixed E235 loop map: Shin-Ōkubo (JY16) to Kanda (JY02) along the top, Shinjuku (JY17) to Tokyo (JY01) along the bottom. */
export function yamanoteLoopPosition(code: string) {
  const n = Number(code.slice(2));
  const step = 1000 / 14;
  if (n >= 2 && n <= 16) return { x: 140 + (16 - n) * step, y: 414, top: true };
  return { x: 140 + (n === 1 ? 14 : n - 17) * step, y: 532, top: false };
}

/** Minutes shown on the map: about two minutes per stop, only for stops up to half an hour ahead. */
export function loopMinutes(index: number) { return index >= 1 && index * 2 <= 30 ? index * 2 : null; }

function broad(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const ja = model.language !== 'en';
  ctx.strokeStyle = C.route; ctx.lineWidth = 54;
  ctx.beginPath(); ctx.roundRect(88, 414, 1104, 118, 59); ctx.stroke();
  const target = targetStation(model).code;
  const ahead = model.route.slice(model.route[0]?.code === target ? 0 : 1);
  const minuteOf = new Map(ahead.map((station, i) => [station.code, loopMinutes(i + 1)] as const));
  let last: { x: number; y: number; minutes: number } | null = null;
  for (const station of model.line.stations) {
    const p = yamanoteLoopPosition(station.code);
    const minutes = minuteOf.get(station.code) ?? null;
    const isTarget = station.code === target;
    if (minutes != null || isTarget) {
      ctx.fillStyle = isTarget ? YELLOW : C.white; ctx.beginPath(); ctx.arc(p.x, p.y, 19, 0, Math.PI * 2); ctx.fill();
      drawFittedText(ctx, String(minutes ?? ''), p.x, p.y + 1, 32, 22, 14, '#1d2124', 700, 'Arial, sans-serif', 'center');
      if (minutes != null && (!last || minutes > last.minutes)) last = { x: p.x, y: p.y, minutes };
    } else {
      ctx.fillStyle = C.white; ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill();
    }
    const text = station.names[model.language] ?? station.names.ja ?? station.code;
    const weight = MAJOR.has(station.code) ? 700 : 500;
    if (ja) vertical(ctx, text, p.x, p.top ? 236 : 566, p.top ? 146 : 132, 25, weight, p.top);
    else {
      ctx.save(); ctx.translate(p.x - 4, p.top ? p.y - 34 : p.y + 34); ctx.rotate(-Math.PI / 3);
      drawFittedText(ctx, text, 0, 0, 150, 20, 13, '#1d2124', weight, 'Arial, sans-serif', p.top ? 'left' : 'right'); ctx.restore();
    }
  }
  if (last) drawFittedText(ctx, ja ? '(分)' : '(min)', last.x + 22, last.y + 10, 44, 12, 10, '#1d2124', 600, ja ? JAPANESE_FONT : 'Arial, sans-serif');
  // White chevrons on the rounded ends show which way trains circulate (numbers rise left to right along the bottom).
  const delta = model.line.directions.find(d => d.id === model.snapshot.direction)?.delta ?? 1;
  ctx.strokeStyle = C.white; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [x, up] of [[88, delta === -1], [1192, delta === 1]] as const) {
    const d = up ? -1 : 1;
    ctx.beginPath(); ctx.moveTo(x - 27, 473 - d * 14); ctx.lineTo(x, 473 + d * 14); ctx.lineTo(x + 27, 473 - d * 14); ctx.stroke();
  }
  drawFittedText(ctx, ja ? 'のりかえ、待ち時間は含まれません。電車により多少時間が異なります。' : 'Transfer and waiting times are not included. Times may differ by train.',
    28, 704, 1224, 16, 12, '#1d2124', 500, ja ? JAPANESE_FONT : 'Arial, sans-serif');
}

/** Point on the "Now stopping" arc, which rises from the bottom right toward the top left. */
function arcPoint(t: number) {
  const p = [[900, 770], [880, 460], [600, 280], [120, 214]];
  const u = 1 - t;
  return { x: u ** 3 * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t ** 3 * p[3][0],
    y: u ** 3 * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t ** 3 * p[3][1] };
}

function nearby(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const ja = model.language !== 'en';
  ctx.strokeStyle = C.route; ctx.lineWidth = 92; ctx.lineCap = 'butt';
  ctx.save(); ctx.beginPath(); ctx.rect(0, 216, 1280, 504); ctx.clip();
  ctx.beginPath(); ctx.moveTo(900, 770); ctx.bezierCurveTo(880, 460, 600, 280, 120, 214); ctx.stroke();
  ctx.restore();
  const stopped = ['stopped', 'arriving'].includes(model.snapshot.state);
  const stops = model.route.slice(stopped ? 0 : 1, (stopped ? 0 : 1) + 5);
  const ts = [.12, .34, .52, .68, .82];
  stops.forEach((station, i) => {
    const p = arcPoint(ts[i]);
    if (i === 0) {
      // Train marker: a red home-plate pointing along the arc, at the current or next stop.
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-Math.PI / 5);
      ctx.fillStyle = TRAIN_RED; ctx.strokeStyle = C.white; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(26, -8); ctx.lineTo(26, 24); ctx.lineTo(-26, 24); ctx.lineTo(-26, -8); ctx.closePath();
      ctx.fill(); ctx.stroke(); ctx.restore();
    } else {
      ctx.fillStyle = C.white; ctx.beginPath(); ctx.arc(p.x, p.y, 25, 0, Math.PI * 2); ctx.fill();
      drawFittedText(ctx, String(loopMinutes(i) ?? ''), p.x, p.y + 1, 40, 28, 16, '#1d2124', 700, 'Arial, sans-serif', 'center');
      if (i === stops.length - 1) drawFittedText(ctx, ja ? '(分)' : '(min)', p.x + 28, p.y + 14, 44, 13, 10, '#1d2124', 600, ja ? JAPANESE_FONT : 'Arial, sans-serif');
    }
    const name = station.names[model.language] ?? station.names.ja ?? station.code;
    const size = 64 - i * 6;
    const spaced = ja && [...name].length <= 3 ? [...name].join(' ') : name;
    drawFittedText(ctx, spaced, p.x + (i === 0 ? 70 : 62), p.y, 1240 - p.x - 70, size, 24, '#1d2124', 700, ja ? JAPANESE_FONT : 'Arial, sans-serif');
  });
  drawTransfers(ctx, model, 40, 330, 470);
}

/** Door illustration: two leaves with tall windows that slide behind the side walls as they open (0 closed .. 1 open). */
function doors(ctx: CanvasRenderingContext2D, cx: number, top: number, openness: number) {
  const w = 300, h = 300, x = cx - w / 2, leaf = w / 2, travel = (leaf - 24) * openness;
  ctx.fillStyle = '#2f3437'; ctx.fillRect(x, top, w, h);
  ctx.save(); ctx.beginPath(); ctx.rect(x, top, w, h); ctx.clip();
  for (const side of [-1, 1] as const) {
    const lx = side < 0 ? x - travel : x + leaf + travel;
    ctx.fillStyle = '#6b7276'; ctx.fillRect(lx + (side < 0 ? 0 : 2), top + 4, leaf - 2, h - 4);
    ctx.fillStyle = '#e9eef2'; ctx.strokeStyle = '#1d2124'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(lx + (side < 0 ? 24 : 26), top + 30, leaf - 50, 120, 16); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#c5cacd'; ctx.fillRect(x - 70, top, 70, h); ctx.fillRect(x + w, top, 70, h);
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: 1 | -1) {
  ctx.fillStyle = '#ee7b30'; ctx.beginPath();
  ctx.moveTo(x + dir * 70, y); ctx.lineTo(x + dir * 10, y - 56); ctx.lineTo(x + dir * 10, y - 26); ctx.lineTo(x - dir * 60, y - 26);
  ctx.lineTo(x - dir * 60, y + 26); ctx.lineTo(x + dir * 10, y + 26); ctx.lineTo(x + dir * 10, y + 56); ctx.closePath(); ctx.fill();
}

/** Door-side page after the Tokyu/JR LCD convention: car strip, a "this side opens" band, the door picture with arrows, a caution strip. */
function platform(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  ctx.fillStyle = '#f4f5f5'; ctx.fillRect(0, 216, 1280, 504);
  const order = model.guidanceStation.platformByDirection[model.snapshot.direction]?.carOrder ?? Array.from({ length: 11 }, (_, i) => i + 1);
  order.forEach((car, i) => {
    const w = 1220 / order.length, x = 30 + i * w;
    ctx.fillStyle = car === model.currentCar ? TRAIN_RED : '#dfe3e6'; ctx.fillRect(x + 2, 226, w - 4, 34);
    drawFittedText(ctx, String(car), x + w / 2, 244, w - 8, 24, 16, car === model.currentCar ? C.white : '#1d2124', 700, 'Arial, sans-serif', 'center');
  });
  const opposite = model.sideLabel === 'opposite side', closing = model.snapshot.state === 'doorsClosing';
  const ja = closing ? 'ドアが閉まります' : model.sideLabel === 'both sides' ? '両側のドアが開きます'
    : model.sideLabel ? (opposite ? '反対側のドアが開きます' : 'こちら側のドアが開きます') : 'ドアにご注意ください';
  const en = closing ? 'Doors are closing.' : model.sideLabel === 'both sides' ? 'Doors on both sides will open.'
    : model.sideLabel ? (opposite ? 'Doors on the opposite side will open.' : 'Doors on this side will open.') : 'Please take care around the doors.';
  ctx.fillStyle = '#e4edf8'; ctx.fillRect(0, 272, 1280, 56);
  drawFittedText(ctx, ja + ' / ' + en, 640, 300, 1220, 32, 18, '#1b4f9c', 700, JAPANESE_FONT, 'center');
  const doorPhase = opposite ? 'closed' : model.snapshot.doors;
  doors(ctx, 640, 344, doorPhase === 'open' ? 1 : doorPhase === 'opening' || doorPhase === 'closing' ? .5 : 0);
  if (model.sideLabel && !opposite && !closing) { arrow(ctx, 360, 494, -1); arrow(ctx, 920, 494, 1); }
  ctx.fillStyle = '#f2cf3a'; ctx.fillRect(0, 656, 1280, 64);
  drawFittedText(ctx, 'ドア引込まれにご注意ください', 30, 688, 760, 30, 18, '#1d2124', 700, JAPANESE_FONT);
  drawFittedText(ctx, 'Caution', 1250, 688, 300, 30, 18, '#1d2124', 700, 'Arial, sans-serif', 'right');
}

function drawTransfers(ctx: CanvasRenderingContext2D, model: ScreenSchedule, x: number, y: number, width: number) {
  const signs = transferSigns(model);
  if (!signs.length) return;
  const ja = model.language !== 'en';
  const name = model.transferStation.names[model.language] ?? model.transferStation.names.ja ?? '';
  drawFittedText(ctx, ja ? name + '駅' : name, x, y, width, 26, 16, '#1d2124', 700, ja ? JAPANESE_FONT : 'Arial, sans-serif');
  drawFittedText(ctx, ja ? '乗換えのご案内' : 'Transfer information', x, y + 32, width, 24, 14, '#1d2124', 500, ja ? JAPANESE_FONT : 'Arial, sans-serif');
  const columns = signs.length > 5 ? 2 : 1, colWidth = width / columns, rows = Math.ceil(signs.length / columns);
  signs.forEach((sign, i) => {
    const cx = x + Math.floor(i / rows) * colWidth, cy = y + 66 + (i % rows) * 40;
    drawLineSymbol(ctx, sign, cx, cy, 28);
    drawFittedText(ctx, ja ? sign.ja : sign.en || sign.ja, cx + 38, cy + 15, colWidth - 46, 22, 12, '#1d2124', 500, ja ? JAPANESE_FONT : 'Arial, sans-serif');
  });
}

/** The full "Transfer" page: a grey caption band and a three-column grid of line symbols with Japanese and English names. */
function transferGrid(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 216, 1280, 504);
  ctx.fillStyle = '#d5d8da'; ctx.fillRect(0, 216, 1280, 44);
  drawFittedText(ctx, 'のりかえ案内', 620, 238, 300, 26, 16, '#1d2124', 500, JAPANESE_FONT, 'right');
  drawFittedText(ctx, 'Transfer', 660, 238, 300, 26, 16, '#1d2124', 500, 'Arial, sans-serif');
  const signs = transferSigns(model).slice(0, 9);
  const rows = Math.max(1, Math.ceil(signs.length / 3));
  const rowHeight = Math.min(140, 430 / rows);
  signs.forEach((sign, i) => {
    const x = 90 + (i % 3) * 400, y = 300 + Math.floor(i / 3) * rowHeight;
    drawLineSymbol(ctx, sign, x, y, 48);
    drawFittedText(ctx, sign.ja, x + 62, y + 22, 320, 46, 22, '#1d2124', 500, JAPANESE_FONT);
    drawFittedText(ctx, sign.en, x + 62, y + 66, 320, 25, 14, '#1d2124', 700, 'Arial, sans-serif');
  });
}

function drawStatic(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1280, 720);
  // Header, route map and detailed map come from the E235-0 theme port, drawn in its 960x540 space.
  ctx.save(); ctx.scale(E235_SCALE, E235_SCALE); drawE235Header(ctx, model);
  if (model.page === 'broad') drawE235RouteMap(ctx, model);
  else if (model.page === 'nearby') drawE235Detailed(ctx, model);
  ctx.restore();
  if (model.page === 'broad' || model.page === 'nearby') return;
  if (model.page === 'platform' || model.page === 'closing') platform(ctx, model);
  else if (model.page === 'transfers') transferGrid(ctx, model);
  else {
    ctx.fillStyle = '#eed85b'; ctx.beginPath(); ctx.moveTo(112, 300); ctx.lineTo(210, 480); ctx.lineTo(14, 480); ctx.closePath(); ctx.fill();
    drawFittedText(ctx, '!', 112, 420, 90, 108, 90, C.ink, 700, 'Arial, sans-serif', 'center');
    const strings = model.page === 'emergency' ? ['緊急停止しました', 'Emergency stop', '紧急停车', '비상 정차']
      : ['運転を見合わせています', 'Service suspended', '暂停服务', '운행 중단'];
    strings.forEach((text, i) => drawFittedText(ctx, text, 264, 304 + i * 84, 940, 46, 28, C.ink));
  }
}

/** Animated red cursor between the last and next stop on the map page; true while it needs frames. */
function drawCursor(ctx: CanvasRenderingContext2D, model: ScreenSchedule, time: number) {
  if (model.page !== 'broad' || ['stopped', 'arriving'].includes(model.snapshot.state)) return false;
  const from = yamanoteLoopPosition(model.snapshot.station), to = yamanoteLoopPosition(targetStation(model).code);
  if (from.y !== to.y || from.x === to.x) return false;
  const dir = Math.sign(to.x - from.x), phase = (time % 1200) / 1200;
  // Glides from just past the last stop toward the next one, then restarts; fades in and out at the ends.
  const x = from.x + (to.x - from.x) * (.3 + .4 * phase), y = to.y;
  ctx.globalAlpha = Math.min(1, phase * 6, (1 - phase) * 6);
  ctx.fillStyle = TRAIN_RED; ctx.beginPath();
  ctx.moveTo(x - dir * 4, y - 16); ctx.lineTo(x + dir * 10, y); ctx.lineTo(x - dir * 4, y + 16);
  ctx.lineTo(x - dir * 13, y + 16); ctx.lineTo(x + dir * 1, y); ctx.lineTo(x - dir * 13, y - 16); ctx.closePath();
  ctx.fill(); ctx.globalAlpha = 1;
  return true;
}

const E235_SCALE = 1280 / E235_WIDTH;
function overlay(ctx: CanvasRenderingContext2D, model: ScreenSchedule, time: number) {
  ctx.save(); ctx.scale(E235_SCALE, E235_SCALE); const animating = drawE235Overlay(ctx, model, time); ctx.restore();
  return animating;
}

export function drawYamanoteLCD(ctx: CanvasRenderingContext2D, model: ScreenSchedule, time = 0) { drawStatic(ctx, model); overlay(ctx, model, time); }

export function createYamanoteRenderer() {
  const cache = new CanvasLayerCache(12);
  return {
    draw(ctx: CanvasRenderingContext2D, width: number, height: number, model: ScreenSchedule, time = 0) {
      const scale = Math.min(width / 1280, height / 720);
      ctx.save(); ctx.translate((width - 1280 * scale) / 2, (height - 720 * scale) / 2); ctx.scale(scale, scale);
      if (!cache.draw(ctx, model.invalidationKey, 1280, 720, layer => drawStatic(layer, model))) drawStatic(ctx, model);
      const animating = overlay(ctx, model, time);
      ctx.restore();
      return animating;
    },
    get cacheSize() { return cache.size; },
    dispose() { cache.clear(); },
  };
}

// JR East E235-0 door LCD, ported 1:1 from the NextStation E235-0 theme (Themes/E235-0/E235-0.xaml).
// NextStation Beta 0.2.2.0, Copyright (C) 2015-2020 WatakuCity (tokiensis); its XML/XAML may be modified and redistributed.
// Everything here draws in the theme's own 960x540 space: a 160px header (MainArea) over a 380px body (OptionalArea).
import type { StationDefinition } from '../lines';
import type { ScreenSchedule } from '../screens';
import { drawLineSymbol, transferSigns } from './transfers';

export const E235_WIDTH = 960;
export const E235_HEIGHT = 540;
const HEADER = 160;
const LINE = '#40c000';
const LINE_EDGE = '#00a000';
const HEADER_BG = '#202020';
const MARKER_RED = '#a00000';
const YELLOW = '#ffe000';
const ACTIVE = '#000000';
const SANS = '"Microsoft Sans Serif", Arial, sans-serif';
const MEIRYO = 'Meiryo, "Meiryo UI", "Yu Gothic UI", sans-serif';
const MEIRYO_UI = '"Meiryo UI", Meiryo, "Yu Gothic UI", sans-serif';
const MAJOR = new Set(['JY01', 'JY05', 'JY13', 'JY17', 'JY20', 'JY25']);

type Lang = 'ja' | 'en' | 'kana';
const langOf = (model: ScreenSchedule): Lang => model.language === 'en' ? 'en' : model.language === 'kana' ? 'kana' : 'ja';
const stopped = (model: ScreenSchedule) => ['stopped', 'arriving'].includes(model.snapshot.state) && model.snapshot.state !== 'arriving';
const running = (model: ScreenSchedule) => !['stopped'].includes(model.snapshot.state);

/** The header/map "current" station: the stop while standing, otherwise the next stop. */
export function e235Target(model: ScreenSchedule): StationDefinition {
  return model.snapshot.state === 'stopped' ? model.station : model.nextStation ?? model.station;
}

/** Our station numbers rise counter-clockwise on screen, which is NextStation's "Opposite" direction. */
const opposite = (model: ScreenSchedule) => (model.line.directions.find(d => d.id === model.snapshot.direction)?.delta ?? 1) === 1;

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, family: string,
  color: string, { weight = 400, align = 'left' as CanvasTextAlign, baseline = 'alphabetic' as CanvasTextBaseline, maxWidth = 0, italic = false } = {}) {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = baseline;
  const width = ctx.measureText(value).width;
  if (maxWidth && width > maxWidth) {
    // WPF Viewbox Stretch="Fill" StretchDirection="DownOnly": squeeze horizontally only.
    ctx.save();
    const anchor = align === 'right' ? x : align === 'center' ? x : x;
    ctx.translate(anchor, 0); ctx.scale(maxWidth / width, 1); ctx.fillText(value, 0, y); ctx.restore();
  } else ctx.fillText(value, x, y);
}

/** Numbering template: 68x70 green rounded square, 52x54 white face, line letters over the number. */
function numbering(ctx: CanvasRenderingContext2D, code: string, x: number, y: number, scale = 1) {
  const parts = code.match(/^([A-Z]+)(\d+)$/);
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.fillStyle = LINE; ctx.beginPath(); ctx.roundRect(0, 0, 68, 70, 6); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(8, 8, 52, 54, 2); ctx.fill();
  text(ctx, parts?.[1] ?? code, 34, 30, 20, SANS, ACTIVE, { weight: 600, align: 'center' });
  if (parts) text(ctx, parts[2], 34, 58, 28, SANS, ACTIVE, { weight: 600, align: 'center' });
  ctx.restore();
}

function terminiFor(model: ScreenSchedule, current: StationDefinition, lang: Lang) {
  const picks = model.route.slice(1).filter(s => MAJOR.has(s.code) && s.code !== current.code).slice(0, 2);
  const name = (s: StationDefinition) => (lang === 'en' ? s.names.en : s.names.ja) ?? s.names.ja ?? s.code;
  return picks.map(name);
}

/** MainArea: columns 240 | 50 | 410 | 100 | 160 on #202020. */
export function drawE235Header(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const lang = langOf(model), current = e235Target(model), state = model.snapshot.state;
  ctx.fillStyle = HEADER_BG; ctx.fillRect(0, 0, E235_WIDTH, HEADER);
  // Column 1: line-colour bar, Margin="2,0,2,8".
  ctx.fillStyle = LINE; ctx.fillRect(242, 0, 46, HEADER - 8);
  // Column 0: destination, Margin="12,4", bottom aligned in a 95px grid.
  const termini = terminiFor(model, current, lang);
  if (lang === 'en') {
    text(ctx, 'Bound for', 12, 61 + 26, 26, SANS, '#d0d0d0', { weight: 700 });
    const lines = termini.length > 1 ? [termini[0] + '&', termini[1]] : [termini[0] ?? ''];
    lines.forEach((line, i) => text(ctx, line, 12, 61 + 30 + 28 + i * 30, 32, SANS, '#ffffff', { weight: 700, maxWidth: 216 }));
  } else {
    const destination = termini.join('・');
    ctx.font = `700 48px ${MEIRYO}`;
    const width = Math.min(216, ctx.measureText(destination).width);
    text(ctx, destination, 12, 156 - 34 - 12, 48, MEIRYO, '#ffffff', { weight: 700, maxWidth: 216 });
    text(ctx, '方面', 12 + width, 156 - 6, 26, MEIRYO, '#ffffff', { weight: 700, align: 'right' });
  }
  // Column 2: caption, numbering block and the station name.
  const caption = lang === 'en'
    ? state === 'stopped' ? 'Now stopping at' : state === 'approaching' || state === 'arriving' ? 'Arriving at' : 'Next'
    : state === 'stopped' ? 'ただいま' : state === 'approaching' || state === 'arriving' ? 'まもなく' : lang === 'kana' ? 'つぎは' : '次は';
  if (lang === 'en') text(ctx, caption, 305, 36, 38, SANS, '#ffffff');
  else text(ctx, caption, 305, 36, 32, MEIRYO, '#ffffff', { weight: 700 });
  const code = lang === 'en' ? current.abbr : undefined;
  const blockHeight = code ? 30 + 70 + 8 : 70 + 16, blockTop = HEADER - 6 - blockHeight;
  ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.roundRect(300, blockTop, 84, blockHeight, 8); ctx.fill();
  if (code) text(ctx, code, 342, blockTop + 25, 26, SANS, '#ffffff', { align: 'center' });
  numbering(ctx, current.code, 308, code ? blockTop + 30 : blockTop + 8);
  const name = (lang === 'en' ? current.names.en : lang === 'kana' ? current.names.kana ?? current.names.ja : current.names.ja) ?? current.code;
  if (lang === 'en') text(ctx, name, 392, 146, 105, SANS, '#ffffff', { maxWidth: 540 });
  else {
    // Meiryo UI 115px with fixed advance widths for two- and three-character names.
    const chars = [...name], advance = chars.length === 2 ? 180 : chars.length === 3 ? 140 : 0;
    ctx.font = `700 115px ${MEIRYO_UI}`;
    if (advance) chars.forEach((ch, i) => text(ctx, ch, 392 + advance * i + advance / 2, 146, 115, MEIRYO_UI, '#ffffff', { weight: 700, align: 'center' }));
    else text(ctx, name, 392, 146, 115, MEIRYO_UI, '#ffffff', { weight: 700, maxWidth: 510 });
  }
  // Column 3: clock (hour right-aligned in 42px, colon, minute right-aligned in 42px), 38px.
  const [hour, minute] = model.clock.split(':');
  text(ctx, hour ?? '', 745, 38, 38, SANS, '#ffffff', { align: 'right' });
  text(ctx, ':', 749, 38, 38, SANS, '#ffffff', { align: 'center' });
  text(ctx, minute ?? '', 795, 38, 38, SANS, '#ffffff', { align: 'right' });
  // Column 4: car number 48px italic in the right 60px; caption 20px #D0D0D0.
  text(ctx, String(model.currentCar), 926, 46, 48, SANS, '#ffffff', { align: 'center', italic: true });
  if (lang === 'en') text(ctx, 'Car No.', 891, 24, 20, SANS, '#d0d0d0', { weight: 700, align: 'right' });
  else text(ctx, '号車', 956, 78, 20, SANS, '#d0d0d0', { weight: 700, align: 'right' });
}

// ---------- Route map (RouteMap / RouteMapList) ----------

const CELL = 54;
const ROW_X = 75; // 15 cells of 54px centred in the 944px ItemsControl (Margin 8,0,8,24).
const UPPER_TRACK = HEADER + 125; // Upper canvas: names 0..120, track at 125..161.
const LOWER_TOP = HEADER + 185 + 2 + 2; // Upper canvas 185 + margins.
const LOWER_TRACK = LOWER_TOP + 24;

/** Fixed loop layout of the real displays: JY16..JY02 along the top, JY17..JY30, JY01 along the bottom. */
export function e235LoopCell(code: string) {
  const n = Number(code.slice(2));
  if (n >= 2 && n <= 16) return { index: 16 - n, upper: true };
  return { index: n === 1 ? 14 : n - 17, upper: false };
}
const cellX = (index: number) => ROW_X + index * CELL + CELL / 2;
const trackY = (upper: boolean) => (upper ? UPPER_TRACK : LOWER_TRACK) + 18;

/** Path2D from SVG data; absent outside the browser (unit tests draw on a stub context). */
const svg = (d: string) => typeof Path2D === 'undefined' ? null : new Path2D(d);

function path(ctx: CanvasRenderingContext2D, d: string, x: number, y: number, fill: string) {
  const shape = svg(d); if (!shape) return;
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = fill; ctx.fill(shape); ctx.restore();
}

/** Loop-end pieces copied from the theme; the 4px V-shaped gap between them is the white direction mark. */
function loopEnds(ctx: CanvasRenderingContext2D, forward: boolean) {
  const left = cellX(0) - 63, right = cellX(14);
  const [ul, ur, ll, lr] = forward ? [52, 68, 8, -8] : [68, 52, -8, 8];
  path(ctx, `M0,60 L0,56 A56,56 0 0 1 56,0 L90.5,0 L90.5,36 L56,36 A20,20 0 0 0 36,56 L36,60 L18,${ul} Z`, left, UPPER_TRACK, LINE);
  path(ctx, `M-0.5,0 L34,0 A56,56 0 0 1 90,56 L90,60 L72,${ur} L54,60 L54,56 A20,20 0 0 0 34,36 L-0.5,36 Z`, right, UPPER_TRACK, LINE);
  path(ctx, `M0,0 L0,4 A56,56 0 0 0 56,60 L90.5,60 L90.5,24 L56,24 A20,20 0 0 1 36,4 L36,0 L18,${ll} Z`, left, LOWER_TOP, LINE);
  path(ctx, `M-0.5,60 L34,60 A56,56 0 0 0 90,4 L90,0 L72,${lr} L54,0 L54,4 A20,20 0 0 1 34,24 L-0.5,24 Z`, right, LOWER_TOP, LINE);
}

/** Vertical Japanese label: Meiryo 25px, one column per line; the long-vowel mark turns vertical. */
function verticalLabel(ctx: CanvasRenderingContext2D, value: string, cx: number, top: number, bottom: number | null, color: string) {
  const columns = value.length > 5 && !value.includes('\n') ? [value.slice(0, 2), value.slice(2)] : value.split('\n');
  const step = 25, maxChars = Math.max(...columns.map(c => [...c].length));
  const scale = Math.min(1, 120 / (maxChars * step));
  columns.forEach((column, c) => {
    const x = columns.length > 1 ? cx + (c === 0 ? 13 : -13) : cx;
    const chars = [...column.replace(/ー/g, '丨')];
    const height = chars.length * step * scale;
    const start = bottom != null ? bottom - height : top;
    chars.forEach((ch, i) => text(ctx, ch, x, start + (i + .5) * step * scale, 25 * Math.min(1, scale * 1.05), MEIRYO, color, { align: 'center', baseline: 'middle' }));
  });
}

export function drawE235RouteMap(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const lang = langOf(model), forward = !opposite(model);
  ctx.fillStyle = LINE;
  ctx.fillRect(cellX(0) - 27.5, UPPER_TRACK, 15 * CELL, 36);
  ctx.fillRect(cellX(0) - 27.5, LOWER_TRACK, 15 * CELL, 36);
  loopEnds(ctx, forward);
  const target = e235Target(model).code;
  const ahead = model.route.slice(model.route[0]?.code === target ? 0 : 1);
  const minutes = new Map(ahead.map((s, i) => [s.code, (i + 1) * 2] as const).filter(([, m]) => m <= 30));
  for (const station of model.line.stations) {
    const cell = e235LoopCell(station.code), cx = cellX(cell.index), cy = trackY(cell.upper);
    const isCurrent = station.code === target, min = minutes.get(station.code);
    if (!(isCurrent && model.snapshot.state === 'stopped')) {
      const big = min != null;
      ctx.fillStyle = isCurrent ? YELLOW : '#ffffff';
      ctx.beginPath(); ctx.arc(cx, cy, big || isCurrent ? 16 : 8, 0, Math.PI * 2); ctx.fill();
      if (isCurrent) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); }
      if (big) text(ctx, String(min), cx, cy + 1, 24, SANS, ACTIVE, { weight: 700, align: 'center', baseline: 'middle', maxWidth: 24 });
    }
    const name = (lang === 'en' ? station.names.en : station.names.ja) ?? station.code;
    if (lang === 'en') {
      ctx.save(); ctx.translate(cx, cell.upper ? cy - 26 : cy + 26); ctx.rotate(-Math.PI / 3);
      text(ctx, name, cell.upper ? 0 : 0, 6, 20, SANS, ACTIVE, { align: cell.upper ? 'left' : 'right', maxWidth: 115, weight: MAJOR.has(station.code) ? 700 : 400 });
      ctx.restore();
    } else verticalLabel(ctx, name, cx, cell.upper ? 0 : LOWER_TRACK + 41, cell.upper ? UPPER_TRACK - 5 : null, ACTIVE);
  }
  const caption = lang === 'en' ? 'Transfer and waiting times are not included. Times may differ by train.'
    : 'のりかえ、待合わせ時間は含まれません。電車により多少時間が異なります。';
  text(ctx, caption, 16, E235_HEIGHT - 6, lang === 'en' ? 13 : 12, lang === 'en' ? SANS : MEIRYO, ACTIVE);
}

/** RouteMap cursor (RunningMarker: 1.2s loop, slides -48 to -28px, fades) or StoppingMarker (1s pulse). */
function routeMapMarker(ctx: CanvasRenderingContext2D, model: ScreenSchedule, time: number) {
  const target = e235Target(model), cell = e235LoopCell(target.code), cx = cellX(cell.index), cy = trackY(cell.upper);
  const forward = !opposite(model);
  // Which way the train runs along this row on screen.
  const dir = cell.upper ? (forward ? 1 : -1) * -1 : (forward ? 1 : -1);
  const towards = opposite(model) ? (cell.upper ? -1 : 1) : (cell.upper ? 1 : -1);
  void dir;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(towards, 1);
  if (model.snapshot.state === 'stopped') {
    const t = (time % 1000) / 1000, h = t < .5 ? 34 + 16 * t : 42 - 16 * (t - .5);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(-28, -21); ctx.lineTo(22, -21); ctx.lineTo(28, 0); ctx.lineTo(22, 21); ctx.lineTo(-28, 21); ctx.closePath(); ctx.fill();
    const s = h / 40; ctx.save(); ctx.scale(s, s);
    ctx.fillStyle = MARKER_RED; ctx.beginPath(); ctx.moveTo(-24, -20); ctx.lineTo(18, -20); ctx.lineTo(24, 0); ctx.lineTo(18, 20); ctx.lineTo(-24, 20); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
  } else {
    const t = (time % 1200) / 1200 * 1.2, x = t < .6 ? -48 + 20 * t / .6 : -28;
    ctx.globalAlpha = Math.min(1, t / .2, t < .9 ? 1 : 1 - (t - .9) / .3);
    ctx.translate(x - 12, -20);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); [[0, 0], [16, 0], [24, 20], [16, 40], [0, 40], [8, 20]].forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath(); ctx.fill();
    ctx.fillStyle = MARKER_RED; ctx.beginPath(); [[2, 0], [14, 0], [22, 20], [14, 40], [2, 40], [10, 20]].forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// ---------- Detailed route map (DetailedRouteMap / DetailedRouteMapList) ----------

/** Five rows from the bottom: circle centre, diameter, minute font, name width and its vertical nudge. */
const ROWS = [
  { cx: 367, cy: 294, d: 72, font: 45, width: 272, dy: -4, gap: 52 },
  { cx: 441.5, cy: 208, d: 59, font: 38, width: 236, dy: -8, gap: 64 },
  { cx: 522, cy: 140, d: 52, font: 32, width: 204, dy: -18, gap: 57 },
  { cx: 605, cy: 91, d: 46, font: 28, width: 181, dy: -25, gap: 40 },
  { cx: 686, cy: 53, d: 44, font: 24, width: 163, dy: -30, gap: 32 },
];

export function drawE235Detailed(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const lang = langOf(model), mirror = opposite(model);
  const mx = (x: number) => mirror ? E235_WIDTH - x : x;
  ctx.save(); ctx.translate(0, HEADER);
  if (mirror) { ctx.translate(E235_WIDTH, 0); ctx.scale(-1, 1); }
  const band = svg('M250,380 A1000,600 0 0 1 750,0 L960,0 A900,500 0 0 0 400,380 Z'), edge = svg('M960,0 A900,500 0 0 0 400,380');
  if (band && edge) { ctx.fillStyle = LINE; ctx.fill(band); ctx.strokeStyle = LINE_EDGE; ctx.lineWidth = 5; ctx.stroke(edge); }
  ctx.restore();
  const isStopped = model.snapshot.state === 'stopped';
  const first = isStopped ? model.station : e235Target(model);
  const startIndex = Math.max(0, model.route.findIndex(s => s.code === first.code));
  const stations = model.route.slice(startIndex, startIndex + 5);
  stations.forEach((station, i) => {
    const row = ROWS[i], x = mx(row.cx), y = HEADER + row.cy;
    if (!(i === 0 && isStopped)) {
      ctx.fillStyle = i === 0 ? YELLOW : '#ffffff'; ctx.beginPath(); ctx.arc(x, y, row.d / 2, 0, Math.PI * 2); ctx.fill();
      if (i === 0) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke(); }
      text(ctx, String((i + (isStopped ? 0 : 1)) * 2), x, y + 2, row.font, SANS, ACTIVE, { weight: 700, align: 'center', baseline: 'middle', maxWidth: row.d - 6 });
    }
    // Name block: numbering (68x70 scaled to 60 high) next to the circle, then the name, scaled to the row width.
    const scale = row.width / 271, edge = x + (mirror ? 1 : -1) * (row.d / 2 + row.gap);
    const nameColor = ACTIVE, nameY = y + row.dy;
    const badgeW = 58 * scale, badgeX = mirror ? edge : edge - badgeW;
    numbering(ctx, station.code, badgeX, nameY - 30 * scale, 60 / 70 * scale);
    const name = (lang === 'en' ? station.names.en : station.names.ja) ?? station.code;
    const family = lang === 'en' ? SANS : MEIRYO, size = 60 * scale, room = 210 * scale;
    const chars = [...name];
    const nameX = mirror ? badgeX + badgeW + 3 * scale : badgeX - 3 * scale;
    if (lang !== 'en' && chars.length === 2) {
      // AdvanceWidth 200 spreads two-character names.
      const adv = Math.min(200 * scale / 2, room / 2);
      chars.forEach((ch, k) => text(ctx, ch, mirror ? nameX + adv * (k + .5) : nameX - adv * (1.5 - k), nameY + size * .36, size, family, nameColor, { weight: 700, align: 'center' }));
    } else text(ctx, name, nameX, nameY + size * .36, size, family, nameColor, { weight: 700, align: mirror ? 'left' : 'right', maxWidth: room });
  });
  drawDetailedTransfers(ctx, model, lang, mirror);
  const caption = lang === 'en' ? 'Transfer and waiting times are not included. Times may differ by train.'
    : 'のりかえ、待合わせ時間は含まれません。電車により多少時間が異なります。';
  text(ctx, caption, mirror ? 16 : E235_WIDTH - 16, E235_HEIGHT - 6, lang === 'en' ? 13 : 12, lang === 'en' ? SANS : MEIRYO, ACTIVE, { align: mirror ? 'left' : 'right' });
}

function drawDetailedTransfers(ctx: CanvasRenderingContext2D, model: ScreenSchedule, lang: Lang, mirror: boolean) {
  const signs = transferSigns(model);
  if (!signs.length) return;
  const station = model.transferStation;
  const name = (lang === 'en' ? station.names.en : station.names.ja) ?? '';
  // Width 350 with Margin 0,85,10,0, right aligned; FlowDirection RightToLeft mirrors it to the left edge.
  const left = mirror ? 10 : E235_WIDTH - 10 - 350, align: CanvasTextAlign = mirror ? 'left' : 'right';
  const anchor = mirror ? left : left + 350, top = HEADER + 85;
  if (lang === 'en') {
    text(ctx, 'Transfer at', anchor, top + 20, 24, SANS, '#a0a0a0', { align });
    text(ctx, `${name} Station`, anchor, top + 45, 24, SANS, ACTIVE, { weight: 700, align, maxWidth: 350 });
  } else {
    text(ctx, `${name}駅`, anchor, top + 20, 24, MEIRYO, ACTIVE, { weight: 700, align });
    text(ctx, '乗換えのご案内', anchor, top + 45, 24, MEIRYO, '#a0a0a0', { align });
  }
  const columns = signs.length > 4 ? 2 : 1, colW = 330 / columns, rows = Math.ceil(signs.length / columns);
  const gridLeft = mirror ? left : left + 20;
  signs.forEach((sign, i) => {
    const x = gridLeft + Math.floor(i / rows) * colW + 2, y = top + 55 + (i % rows) * 30;
    drawLineSymbol(ctx, sign, x, y, 24);
    text(ctx, lang === 'en' ? sign.en || sign.ja : sign.ja, x + 29, y + 20, 24, lang === 'en' ? SANS : MEIRYO, ACTIVE, { maxWidth: colW - 40 });
  });
}

/** DetailedRouteMap cursor: chevron rotated 26° sliding up the line (1.3s), or the pulsing stopping marker. */
function detailedMarker(ctx: CanvasRenderingContext2D, model: ScreenSchedule, time: number) {
  ctx.save(); ctx.translate(0, HEADER);
  if (opposite(model)) { ctx.translate(E235_WIDTH, 0); ctx.scale(-1, 1); }
  const ox = 380, oy = 360;
  if (model.snapshot.state === 'stopped') {
    const t = (time % 1000) / 1000, h = t < .5 ? 86 + 20 * t : 96 - 20 * (t - .5);
    ctx.translate(0, -10); ctx.scale(1, .8);
    ctx.translate(ox, oy); ctx.rotate(30 * Math.PI / 180); ctx.translate(-ox, -oy);
    const house = (s: number) => { ctx.beginPath(); [[0, 100], [0, 15], [40, 0], [80, 15], [80, 100]].forEach(([px, py], i) => { const X = 300 + 40 + (px - 40) * s, Y = 260 + 50 + (py - 50) * s; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.closePath(); };
    ctx.fillStyle = '#ffffff'; house(1); ctx.fill();
    ctx.fillStyle = MARKER_RED; house(h / 100); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(340, 310, 12, 0, Math.PI * 2); ctx.fill();
  } else {
    const t = (time % 1300) / 1000, ty = t < .6 ? 85 - 33 * t / .6 : 52;
    ctx.globalAlpha = Math.min(1, t / .2, t < 1 ? 1 : 1 - (t - 1) / .3);
    ctx.translate(ox, oy); ctx.rotate(26 * Math.PI / 180); ctx.translate(-ox, -oy); ctx.translate(0, ty);
    ctx.beginPath(); [[0, 14], [37.5, 0], [75, 14], [75, 40], [37.5, 26], [0, 40]].forEach(([px, py], i) => { const X = 302.5 + px, Y = 290 + py; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.closePath();
    ctx.fillStyle = MARKER_RED; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
  }
  ctx.restore();
}

/** Animated overlay for the current page; returns true while it needs more frames. */
export function drawE235Overlay(ctx: CanvasRenderingContext2D, model: ScreenSchedule, time: number): boolean {
  if (model.page === 'broad') { routeMapMarker(ctx, model, time); return true; }
  if (model.page === 'nearby') { detailedMarker(ctx, model, time); return true; }
  return false;
}
void running; void stopped;

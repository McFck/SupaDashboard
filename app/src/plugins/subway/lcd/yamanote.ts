import { stationMinutes, type ScreenSchedule } from '../screens';
import { CanvasLayerCache, drawBadge, drawFacilitySymbol, drawFittedText, drawStationName, E235_COLORS as C, JAPANESE_FONT } from './shared';

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

function header(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const ja = model.language !== 'en';
  const current = ['stopped', 'arriving'].includes(model.snapshot.state) ? model.station : model.nextStation ?? model.station;
  const direction = model.line.directions.find(item => item.id === model.snapshot.direction);
  const landmarks = model.route.slice(1).filter(s => ['JY07', 'JY13', 'JY17', 'JY20', 'JY25'].includes(s.code)).slice(0, 2);
  const directionText = landmarks.map(s => s.names[model.language] ?? s.names.ja).join(model.language === 'en' ? ' / ' : '・')
    || direction?.names[model.language] || direction?.names.ja || '';
  ctx.fillStyle = C.header; ctx.fillRect(0, 0, 1280, 216);
  ctx.fillStyle = C.route; ctx.fillRect(346, 0, 22, 216);
  drawFittedText(ctx, directionText, 24, 132, 298, ja ? 45 : 39, 26, C.white, 700, JAPANESE_FONT);
  drawFittedText(ctx, ja ? '方面' : 'Bound for', 318, 184, 270, 28, 22, C.white, 500, JAPANESE_FONT, 'right');
  const state = model.snapshot.state;
  const caption = state === 'stopped' || state === 'arriving' ? (ja ? 'ただいま' : 'Now stopping at')
    : state === 'approaching' ? (ja ? 'まもなく' : 'Arriving at') : (ja ? '次は' : 'Next');
  drawFittedText(ctx, caption, 390, 36, 540, 31, 24, C.white, 600);
  drawFittedText(ctx, model.clock, 1126, 34, 150, 30, 24, C.white, 500, 'Arial, sans-serif', 'right');
  drawFittedText(ctx, String(model.currentCar), 1230, 38, 70, 44, 32, C.white, 500, 'Arial, sans-serif', 'center');
  drawFittedText(ctx, ja ? '号車' : 'Car', 1230, 78, 70, 20, 16, C.white, 500, JAPANESE_FONT, 'center');
  drawBadge(ctx, current.code, 390, 94, 104, C.route);
  drawStationName(ctx, current, model.language, 520, 140, 680, ja ? 126 : 104, 54, C.white);
}

function vertical(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, height: number, size: number) {
  const step = Math.min(size, height / Math.max(1, [...text].length));
  [...text].forEach((char, i) => drawFittedText(ctx, char, x, y + step * (i + .5), 60, step, 12, C.ink, 600, JAPANESE_FONT, 'center'));
}

function broad(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const delta = model.line.directions.find(d => d.id === model.snapshot.direction)?.delta ?? 1;
  const points = yamanoteBroadNodePositions(model.route.length, delta);
  ctx.strokeStyle = C.route; ctx.lineWidth = 48; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.roundRect(84, 418, 1112, 112, 56); ctx.stroke();
  model.route.forEach((station, i) => {
    const point = points[i], top = i < Math.ceil(points.length / 2);
    const current = station.code === model.snapshot.station;
    ctx.fillStyle = current ? C.currentCar : C.white;
    if (current) ctx.fillRect(point.x - 15, point.y - 15, 30, 30);
    else {
      ctx.beginPath(); ctx.arc(point.x, point.y, 17, 0, Math.PI * 2); ctx.fill();
      drawFittedText(ctx, String(stationMinutes(model, station.code) ?? ''), point.x, point.y, 32, 21, 15, C.ink, 700, 'Arial, sans-serif', 'center');
    }
    const text = station.names[model.language] ?? station.names.ja ?? station.code;
    if (model.language === 'en') {
      ctx.save(); ctx.translate(point.x, top ? 391 : 562); ctx.rotate(-Math.PI / 3);
      drawFittedText(ctx, text, 0, 0, 156, 20, 15, C.ink, 600, 'Arial, sans-serif', top ? 'left' : 'right'); ctx.restore();
    } else vertical(ctx, text, point.x, top ? 232 : 564, top ? 152 : 110, 24);
  });
  drawFittedText(ctx, model.language === 'en' ? 'Transfer and waiting times are not included.' : 'のりかえ・待ち時間は含まれません。電車により多少時間が異なります。', 28, 704, 1224, 18, 14, C.ink, 500);
}

function nearby(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const reverse = model.line.directions.find(d => d.id === model.snapshot.direction)?.delta === -1;
  ctx.save(); if (reverse) { ctx.translate(1280, 0); ctx.scale(-1, 1); }
  ctx.strokeStyle = C.route; ctx.lineWidth = 106;
  ctx.beginPath(); ctx.moveTo(450, 758); ctx.bezierCurveTo(566, 426, 820, 284, 1300, 244); ctx.stroke();
  ctx.restore();
  const positions = [{ x: 498, y: 634 }, { x: 622, y: 477 }, { x: 796, y: 361 }, { x: 960, y: 310 }, { x: 1160, y: 278 }];
  model.route.slice(1, 6).forEach((station, i) => {
    const original = positions[i], p = { ...original, x: reverse ? 1280 - original.x : original.x }, size = 62 - i * 8;
    ctx.fillStyle = C.white; ctx.beginPath(); ctx.arc(p.x, p.y, 31 - i * 3, 0, Math.PI * 2); ctx.fill();
    drawFittedText(ctx, String(stationMinutes(model, station.code) ?? ''), p.x, p.y, 54, 36 - i * 3, 18, C.ink, 700, 'Arial, sans-serif', 'center');
    drawStationName(ctx, station, model.language, p.x + (reverse ? 72 : -72), Math.max(256, p.y - 30), 470 - i * 36, size, 22, C.ink, reverse ? 'left' : 'right');
    drawBadge(ctx, station.code, p.x + (reverse ? 32 : -66), p.y - 9, 34, C.route);
  });
  drawTransfers(ctx, model, reverse ? 40 : 880, 480, 360);
}

function doors(ctx: CanvasRenderingContext2D, x: number, y: number, open: boolean) {
  ctx.fillStyle = '#eef3f7'; ctx.fillRect(x, y, 200, 150);
  ctx.fillStyle = '#4580a5'; const gap = open ? 50 : 4;
  ctx.fillRect(x + 8, y + 8, 92 - gap / 2, 134); ctx.fillRect(x + 100 + gap / 2, y + 8, 92 - gap / 2, 134);
  ctx.fillStyle = '#bdddeb'; ctx.fillRect(x + 18, y + 18, 56, 62); ctx.fillRect(x + 126, y + 18, 56, 62);
  ctx.fillStyle = '#f5e45b'; ctx.fillRect(x - 12, y + 152, 224, 8);
}

function platform(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  ctx.fillStyle = '#8a9eb8'; ctx.fillRect(0, 270, 1280, 250);
  const order = model.guidanceStation.platformByDirection[model.snapshot.direction]?.carOrder ?? Array.from({ length: 11 }, (_, i) => i + 1);
  order.forEach((car, i) => {
    const x = 30 + i * 111;
    ctx.fillStyle = car === model.currentCar ? C.currentCar : '#d6e0e9'; ctx.fillRect(x, 228, 108, 40);
    drawFittedText(ctx, String(car), x + 54, 248, 102, 29, 20, car === model.currentCar ? C.white : C.ink, 700, 'Arial, sans-serif', 'center');
  });
  const facilities = model.guidanceStation.platformByDirection[model.snapshot.direction]?.facilities ?? [];
  facilities.forEach(f => {
    const x = 40 + (f.relativePosition ?? ((f.car ?? 1) - .5) / 11) * 1200;
    ctx.fillStyle = C.exit; ctx.fillRect(Math.max(12, x - 110), 304, 220, 44);
    drawFittedText(ctx, f.label, x, 326, 210, 24, 14, C.ink, 700, JAPANESE_FONT, 'center');
    ctx.strokeStyle = '#edf2f5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, 349); ctx.lineTo(x, 480); ctx.stroke();
    drawFacilitySymbol(ctx, f.kind, x, 410, 68);
  });
  ctx.fillStyle = C.doorPanel; ctx.fillRect(0, 520, 1280, 200);
  const opposite = model.sideLabel === 'opposite side';
  doors(ctx, 58, 544, !opposite && model.snapshot.doors === 'open');
  if (opposite) {
    ctx.fillStyle = '#cf2835'; ctx.beginPath(); ctx.arc(158, 612, 39, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(130, 603, 56, 18);
  } else if (model.sideLabel) {
    ctx.fillStyle = C.white;
    for (const direction of [-1,1]) {
      const x=158+direction*126;
      ctx.beginPath(); ctx.moveTo(x+direction*20, 612); ctx.lineTo(x-direction*4, 596); ctx.lineTo(x-direction*4, 628); ctx.closePath(); ctx.fill();
    }
  }
  const ja = model.snapshot.state === 'doorsClosing' ? 'ドアが閉まります'
    : model.sideLabel === 'both sides' ? '両側のドアが開きます' : model.sideLabel ? (opposite ? '反対側のドアが開きます' : 'こちら側のドアが開きます')
    : model.snapshot.doors === 'open' ? 'ドアが開いています' : 'ドアにご注意ください';
  const en = model.snapshot.state === 'doorsClosing' ? 'Doors are closing.'
    : model.sideLabel === 'both sides' ? 'Doors on both sides will open.' : model.sideLabel ? (opposite ? 'Doors on the opposite side will open.' : 'Doors on this side will open.') : 'Please take care around the doors.';
  drawFittedText(ctx, ja, 322, 594, 906, 51, 32, C.white);
  drawFittedText(ctx, en, 322, 653, 906, 29, 20, C.white, 600, 'Arial, sans-serif');
}

function drawTransfers(ctx: CanvasRenderingContext2D, model: ScreenSchedule, x: number, y: number, width: number) {
  drawFittedText(ctx, model.language === 'en' ? 'Transfer information' : 'お乗り換えのご案内', x, y, width, 30, 18, C.ink);
  model.transfers.flatMap(text => text.split(/[、,]/).map(part => part.trim()).filter(Boolean)).slice(0, 4).forEach((transfer, i) => {
    if (isTransferBadge(transfer)) drawBadge(ctx, transfer, x, y + 32 + i * 44, 38, '#8e687e');
    else drawFittedText(ctx, transfer, x, y + 50 + i * 44, width, 26, 16, C.ink, 600);
  });
}

function drawStatic(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  ctx.fillStyle = C.body; ctx.fillRect(0, 0, 1280, 720); header(ctx, model);
  if (model.page === 'platform' || model.page === 'closing') platform(ctx, model);
  else if (model.page === 'broad') broad(ctx, model);
  else if (model.page === 'nearby') nearby(ctx, model);
  else if (model.page === 'transfers') { nearby(ctx, model); }
  else {
    ctx.fillStyle = '#eed85b'; ctx.beginPath(); ctx.moveTo(112, 300); ctx.lineTo(210, 480); ctx.lineTo(14, 480); ctx.closePath(); ctx.fill();
    drawFittedText(ctx, '!', 112, 420, 90, 108, 90, C.ink, 700, 'Arial, sans-serif', 'center');
    const strings = model.page === 'emergency' ? ['緊急停止しました', 'Emergency stop', '紧急停车', '비상 정차']
      : ['運転を見合わせています', 'Service suspended', '暂停服务', '운행 중단'];
    strings.forEach((text, i) => drawFittedText(ctx, text, 264, 304 + i * 84, 940, 46, 28, C.ink));
  }
}

export function drawYamanoteLCD(ctx: CanvasRenderingContext2D, model: ScreenSchedule) { drawStatic(ctx, model); }

export function createYamanoteRenderer() {
  const cache = new CanvasLayerCache(12);
  return {
    draw(ctx: CanvasRenderingContext2D, width: number, height: number, model: ScreenSchedule) {
      const scale = Math.min(width / 1280, height / 720);
      ctx.save(); ctx.translate((width - 1280 * scale) / 2, (height - 720 * scale) / 2); ctx.scale(scale, scale);
      if (!cache.draw(ctx, model.invalidationKey, 1280, 720, layer => drawStatic(layer, model))) drawStatic(ctx, model);
      ctx.restore();
    },
    get cacheSize() { return cache.size; },
    dispose() { cache.clear(); },
  };
}

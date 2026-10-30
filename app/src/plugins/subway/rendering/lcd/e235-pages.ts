// Canvas port of NextStation's E235-0 optional templates.
// NextStation, Copyright (C) 2015-2020 WatakuCity (tokiensis).
import type { ScreenSchedule } from '../screens';
import { e235Station, e235TrainStop, e235TransferLayout } from './e235-data';
import { ImageSet } from '../engine/image-set';

const SANS = '"Microsoft Sans Serif", "MS UI Gothic", Arial, sans-serif';
const JA = 'Meiryo, "Yu Gothic UI", sans-serif';
const UI = '"Meiryo UI", Meiryo, sans-serif';
function label(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  width = 0,
  color = '#000000',
  family = SANS,
  weight = 400,
  align: CanvasTextAlign = 'left',
) {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align;
  const measured = ctx.measureText(value).width;
  ctx.save();
  ctx.translate(x, y);
  if (width && measured > width) ctx.scale(width / measured, 1);
  ctx.fillText(value, 0, 0);
  ctx.restore();
}
type Icon = ReturnType<typeof e235Station>['transfers'][number]['icons'][number];
export function drawE235LineIcon(
  ctx: CanvasRenderingContext2D,
  icon: Icon,
  x: number,
  y: number,
  size: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 64, size / 64);
  ctx.fillStyle = icon.color ?? '#000000';
  if (icon.type === 'Subway') {
    ctx.beginPath();
    ctx.arc(32, 32, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(32, 32, 19, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, icon.lineLetter ?? '', 32, 43, 30, 38, '#000000', SANS, 700, 'center');
  } else if (icon.type === 'TrainIcon') {
    ctx.beginPath();
    ctx.roundRect(0, 0, 64, 64, 3);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(14, 6, 36, 40, 6);
    ctx.fill();
    ctx.fillStyle = icon.color ?? '#000000';
    ctx.fillRect(25, 8.5, 14, 3);
    ctx.fillRect(18, 15, 28, 14);
    for (const cx of [21, 43]) {
      ctx.beginPath();
      ctx.arc(cx, 38, 2, 0, 2 * Math.PI);
      ctx.fill();
    }
    polygon(
      ctx,
      [
        [22, 45],
        [42, 45],
        [52, 58],
        [48, 58],
        [41, 49],
        [23, 49],
        [16, 58],
        [12, 58],
      ],
      '#ffffff',
    );
  } else if (icon.type.startsWith('Shinkansen')) {
    ctx.fillRect(0, 0, 64, 64);
    if (icon.secondaryColor) {
      ctx.fillStyle = icon.secondaryColor;
      ctx.fillRect(0, 32, 64, 32);
    }
  } else {
    ctx.beginPath();
    ctx.roundRect(0, 0, 64, 64, 3);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(6, 6, 52, 52);
    label(ctx, icon.lineLetter ?? '', 32, 44, 34, 52, '#000000', SANS, 400, 'center');
  }
  ctx.restore();
}
function polygon(ctx: CanvasRenderingContext2D, points: number[][], color: string) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x!, y!) : ctx.moveTo(x!, y!)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawE235DetailedTransfers(
  ctx: CanvasRenderingContext2D,
  model: ScreenSchedule,
  mirror: boolean,
) {
  const station = e235Station(target(model));
  const layout = e235TransferLayout(
    station.code,
    model.snapshot.direction,
    'DetailedRouteMap',
    model.language,
  );
  if (!layout.lines.length) return;
  const en = model.language === 'en',
    left = mirror ? 10 : 600,
    anchor = mirror ? left : 950;
  const align = mirror ? 'left' : 'right';
  label(
    ctx,
    en ? 'Transfer at' : `${station.names.ja}駅`,
    anchor,
    265,
    24,
    350,
    en ? '#a0a0a0' : '#000000',
    en ? SANS : JA,
    en ? 400 : 700,
    align,
  );
  label(
    ctx,
    en ? `${station.names.en} Station` : '乗換えのご案内',
    anchor,
    290,
    24,
    350,
    en ? '#000000' : '#a0a0a0',
    en ? SANS : JA,
    en ? 700 : 400,
    align,
  );
  const rows = Array.from({ length: layout.rows! }, () => 30);
  for (const item of layout.lines) {
    const name = en ? item.aliasEn || item.transfer.en : item.aliasJa || item.transfer.ja;
    rows[item.row!] = Math.max(rows[item.row!]!, name.split('\n').length * 25 + 5);
  }
  const col = 330 / layout.columns!;
  for (const item of layout.lines) {
    const column = item.column!;
    const x = left + (mirror ? 0 : 20) + column * col + 2;
    const y = 300 + rows.slice(0, item.row!).reduce((a, b) => a + b, 0);
    const icon =
      item.transfer.icons[
        item.iconRef ?? Math.floor(model.visibleElapsed / 3000) % item.transfer.icons.length
      ];
    if (icon) drawE235LineIcon(ctx, icon, x, y, 24);
    const name = en ? item.aliasEn || item.transfer.en : item.aliasJa || item.transfer.ja;
    name
      .split('\n')
      .forEach((line, i) =>
        label(
          ctx,
          line,
          x + 29,
          y + 20 + 25 * i,
          24,
          col * (item.columnSpan ?? 1) - 40,
          '#000000',
          en ? SANS : JA,
        ),
      );
  }
}

const E235_TRIMMED = new Set([
  'UpStairs',
  'UpStairs_small',
  'DownStairs',
  'UpEscalator',
  'DownEscalator',
  'Elevator',
]);
export const e235Images = new ImageSet(
  Object.fromEntries(
    [...E235_TRIMMED, 'PrioritySeat', 'MobilePhone'].map((name) => [
      name,
      `${import.meta.env.BASE_URL}subway/e235/${name}.svg`,
    ]),
  ),
  (name) => E235_TRIMMED.has(name),
);
function target(model: ScreenSchedule) {
  return ['stopped', 'doorsClosing', 'arriving'].includes(model.snapshot.state)
    ? model.station.code
    : (model.nextStation?.code ?? model.station.code);
}
function stopFor(model: ScreenSchedule) {
  return e235TrainStop(
    target(model),
    model.snapshot.direction,
    model.snapshot.initialStop ? 'initial' : 'regular',
  );
}
function thisSide(model: ScreenSchedule) {
  return stopFor(model).door?.toLowerCase() === (model.viewingSide ?? 'right');
}
type PlatformObject = ReturnType<
  typeof e235Station
>['platforms'][number]['blocks'][number]['units'][number]['groups'][number]['objects'][number];
export function e235PackPlatformObjects(objects: readonly PlatformObject[]) {
  const packed: PlatformObject[][] = [];
  for (let i = 0; i < objects.length; i++) {
    const first = objects[i]!,
      next = objects[i + 1];
    const pair =
      next &&
      first.direction === next.direction &&
      first.position === next.position &&
      first.key?.startsWith('Up') === next.key?.startsWith('Up') &&
      /Stairs|Escalator/.test(first.key!) &&
      /Stairs|Escalator/.test(next.key!) &&
      first.key !== next.key;
    packed.push(pair ? [first, objects[++i]!] : [first]);
  }
  return packed;
}

function transferGrid(
  ctx: CanvasRenderingContext2D,
  model: ScreenSchedule,
  mode: 'Transfers' | 'Platform',
) {
  const layout = e235TransferLayout(target(model), model.snapshot.direction, mode, 'ja');
  if (!layout.lines.length) return;
  const full = mode === 'Transfers',
    jaSize = full ? 38 : 28,
    enSize = full ? 24 : 16,
    iconSize = full ? 36 : 30;
  const gap = full ? 36 : 18,
    rowHeight = full ? 96 : 54;
  const widths = Array.from({ length: layout.columns! }, () => 0);
  for (const item of layout.lines) {
    ctx.font = `${jaSize}px ${SANS}`;
    const ja = ctx.measureText((item.aliasJa || item.transfer.ja).replace(/\n/g, '')).width;
    ctx.font = `${enSize}px ${SANS}`;
    const en = ctx.measureText((item.aliasEn || item.transfer.en).replace(/\n/g, '')).width;
    const width =
      (full ? 2 : 0) + iconSize + (full ? 6 : 4) + Math.min(680, Math.max(ja, en)) + gap;
    const span = item.columnSpan ?? 1;
    for (let c = item.column!; c < item.column! + span; c++)
      widths[c] = Math.max(widths[c]!, width / span);
  }
  const width = widths.reduce((a, b) => a + b, 0),
    height = layout.rows! * rowHeight;
  const scale = Math.min(1, (full ? 864 : 870) / width, (full ? 286 : 100) / height);
  ctx.save();
  ctx.translate(
    (960 - width * scale) / 2,
    full ? 214 + (286 - height * scale) / 2 : 400 + (100 - height * scale) / 2,
  );
  ctx.scale(scale, scale);
  for (const item of layout.lines) {
    const x = widths.slice(0, item.column!).reduce((a, b) => a + b, 0) + (full ? 2 : 0),
      y = item.row! * rowHeight + (full ? 0 : 5);
    const icon =
      item.transfer.icons[
        item.iconRef ?? Math.floor(model.visibleElapsed / 3000) % item.transfer.icons.length
      ];
    if (icon) drawE235LineIcon(ctx, icon, x, y, iconSize);
    const tx = x + iconSize + (full ? 6 : 4),
      room =
        widths
          .slice(item.column!, item.column! + (item.columnSpan ?? 1))
          .reduce((a, b) => a + b, 0) -
        iconSize -
        gap -
        6;
    label(
      ctx,
      (item.aliasJa || item.transfer.ja).replace(/\n/g, ''),
      tx,
      y + (full ? 32 : 25),
      jaSize,
      room,
    );
    label(
      ctx,
      (item.aliasEn || item.transfer.en).replace(/\n/g, ''),
      tx + (full ? 0 : 2),
      y + (full ? 60 : 43),
      enSize,
      room,
    );
  }
  ctx.restore();
}

/** PlatformBase, PlatformBlocks/Units, Exits and Train use the theme's 76px car pitch. */
export function drawE235Platform(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const station = e235Station(target(model)),
    stop = stopFor(model);
  const platform = station.platforms[stop.platformRef ?? 0]!;
  const right = (model.viewingSide ?? 'right') === 'right',
    near = thisSide(model);
  const platformWidth = platform.length! * 76,
    px = right ? 0 : 960 - platformWidth;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 160, 960, 240);
  ctx.clip();
  ctx.fillStyle = '#c0c9d0';
  ctx.fillRect(px, 206, platformWidth, 138);
  ctx.fillStyle = '#607080';
  ctx.fillRect(px, 344, platformWidth, 10);
  ctx.fillStyle = '#e0e080';
  for (let x = px; x < px + platformWidth; x += 15) {
    ctx.fillRect(x, 211, 8, 3);
    ctx.fillRect(x, 336, 8, 3);
  }
  const reverse = (model.snapshot.direction === 'outer') === right;
  const mapX = (x: number) => px + (reverse ? platformWidth - x : x);
  let offset = 0;
  for (const block of platform.blocks) {
    const base = offset;
    offset += block.length! * 76;
    block.units.forEach((unit, i) =>
      unit.groups.forEach((group) => {
        const first = group.objects[0];
        if (!first) return;
        const pos =
          first.position === 'Front'
            ? 57
            : first.position === 'Back'
              ? 19
              : first.position === 'Border'
                ? 76
                : 38;
        const akihabara = station.code === 'JY03';
        const cx = mapX(base + i * 76 + pos),
          iconBottom = near ? (akihabara ? 279 : 310) : akihabara ? 324 : 296;
        const exitY = near
          ? group.targetExit && group.targetExit > 0
            ? akihabara
              ? 295
              : 255
            : 204
          : group.targetExit && group.targetExit > 0
            ? akihabara
              ? 261
              : 351
            : 356;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(
          cx - 3,
          Math.min(iconBottom - 25, exitY),
          6,
          Math.abs(exitY - (iconBottom - 25)),
        );
        ctx.fillStyle = '#000000';
        ctx.fillRect(
          cx - 1,
          Math.min(iconBottom - 25, exitY),
          2,
          Math.abs(exitY - (iconBottom - 25)),
        );
        const packed = e235PackPlatformObjects(group.objects);
        const heights: Record<string, number> = {
          UpStairs: 50,
          DownStairs: 26,
          UpEscalator: 45,
          DownEscalator: 30,
          Elevator: 60,
        };
        const itemHeights = packed.map((items) =>
          items.length === 2
            ? items[0]!.key!.startsWith('Up')
              ? 60
              : (reverse ? items[1] : items[0])!.key === 'DownStairs'
                ? 50
                : 54
            : heights[items[0]!.key!]!,
        );
        let bottom =
          iconBottom +
          (packed.length > 1 ? (near ? 22 : 35) : 0) -
          itemHeights.reduce((a, b) => a + b, 0);
        packed.forEach((items, j) => {
          const obj = items[0]!,
            height = itemHeights[j]!;
          bottom += height;
          ctx.save();
          ctx.translate(cx, bottom);
          if (obj.direction !== 'None' && (obj.direction === 'Opposite') !== reverse)
            ctx.scale(-1, 1);
          const paired = items.length === 2;
          if (paired) {
            // PlatformObjectPackingConverter combines stairs/escalators that face the same way.
            const stairsFirst = (reverse ? items[1]!.key : obj.key)!.endsWith('Stairs');
            if (obj.key!.startsWith('Up')) {
              e235Images.draw(ctx, stairsFirst ? 'UpStairs' : 'UpEscalator', -18, -60, 36, 50);
              e235Images.draw(
                ctx,
                stairsFirst ? 'UpEscalator' : 'UpStairs_small',
                -19,
                -50,
                38,
                50,
              );
            } else if (stairsFirst) {
              ctx.fillStyle = '#808080';
              ctx.fillRect(-16, -50, 34, 20);
              ctx.fillRect(-9, -50, 27, 50);
              ctx.save();
              ctx.beginPath();
              ctx.rect(-16, -50, 34, 50);
              ctx.clip();
              e235Images.draw(ctx, 'DownStairs', -19, -49, 44, 60);
              ctx.restore();
              ctx.save();
              ctx.beginPath();
              ctx.rect(-19, -50, 37, 50);
              ctx.clip();
              e235Images.draw(ctx, 'DownEscalator', -19, -32, 44, 61);
              ctx.restore();
            } else {
              ctx.fillStyle = '#808080';
              ctx.fillRect(-12, -50, 30, 40);
              ctx.save();
              ctx.beginPath();
              ctx.rect(-19, -54, 37, 50);
              ctx.clip();
              e235Images.draw(ctx, 'DownEscalator', -19, -54, 46, 64);
              ctx.restore();
              ctx.save();
              ctx.beginPath();
              ctx.rect(-16, -31, 34, 31);
              ctx.clip();
              e235Images.draw(ctx, 'DownStairs', -19, -31, 44, 60);
              ctx.restore();
            }
          } else if (obj.key === 'DownStairs') {
            ctx.fillStyle = '#808080';
            ctx.fillRect(-18, -26, 36, 26);
            ctx.beginPath();
            ctx.rect(-18, -26, 36, 26);
            ctx.clip();
            e235Images.draw(ctx, 'DownStairs', -21, -25, 45, 60);
          } else if (obj.key === 'DownEscalator') {
            ctx.beginPath();
            ctx.rect(-18, -30, 36, 30);
            ctx.clip();
            ctx.fillStyle = '#808080';
            ctx.fillRect(-6, -26, 24, 26);
            e235Images.draw(ctx, 'DownEscalator', -18, -30, 50, 55);
          } else e235Images.draw(ctx, obj.key!, -18, -height, 36, height);
          ctx.restore();
        });
      }),
    );
    block.exits.forEach((exit, i) => {
      const position = (p: string | null) =>
        p === 'Back' ? 1 : p === 'Front' ? 39 : p === 'Center' ? 20 : 58;
      const start = base + exit.offset! * 76 + position(exit.start),
        end = base + (exit.offset! + exit.length! - 1) * 76 + position(exit.end) + 36;
      const x = Math.min(mapX(start), mapX(end)),
        width = Math.abs(end - start),
        y = near
          ? i === 0
            ? 166
            : station.code === 'JY03'
              ? 295
              : 209
          : i === 0
            ? 356
            : station.code === 'JY03'
              ? 223
              : 313;
      ctx.fillStyle = '#f0f000';
      ctx.fillRect(x, y, width, 38);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 37);
      label(ctx, exit.ja, x + width / 2, y + 21, 18, width - 8, '#000000', SANS, 400, 'center');
      label(ctx, exit.en, x + width / 2, y + 34, 12, width - 8, '#000000', SANS, 400, 'center');
    });
  }
  const trainWidth = 11 * 76,
    trainX = right
      ? (stop.stopPosOffset ?? 0) * 76
      : 960 - (stop.stopPosOffset ?? 0) * 76 - trainWidth,
    trainY = near ? 357 : 167;
  for (let i = 0; i < 11; i++) {
    const car = (model.snapshot.direction === 'outer') !== right ? 11 - i : i + 1,
      selected = car === model.currentCar;
    const x = trainX + i * 76 + (selected ? 1 : 2),
      y = trainY - (selected ? 1 : 0),
      width = selected ? 74 : 72,
      height = selected ? 38 : 36;
    ctx.fillStyle = selected ? '#ffffff' : '#d0d9e0';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.6;
    carBody(ctx, x, y, width, height, i === 0, i === 10);
    ctx.fill();
    ctx.stroke();
    if (selected) {
      ctx.fillStyle = '#d00000';
      carBody(ctx, x + 3, y + 3, width - 6, height - 6, i === 0, i === 10, true);
      ctx.fill();
    }
    ctx.save();
    ctx.font = `italic 700 32px ${SANS}`;
    ctx.fillStyle = selected ? '#ffffff' : '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(car), x + width / 2 + (right ? -4 : 4), y + height / 2 + 11);
    ctx.restore();
  }
  const leftwards = right;
  const ax = leftwards ? trainX - 24 : trainX + trainWidth + 7;
  polygon(
    ctx,
    leftwards
      ? [
          [ax + 17, trainY + 3],
          [ax, trainY + 18],
          [ax + 17, trainY + 33],
        ]
      : [
          [ax, trainY + 3],
          [ax + 17, trainY + 18],
          [ax, trainY + 33],
        ],
    '#404040',
  );
  ctx.restore();
}

function carBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  head: boolean,
  tail: boolean,
  inset = false,
) {
  const rx = inset ? 9 : 12,
    ry = inset ? 11 : 14;
  ctx.beginPath();
  ctx.moveTo(x + (head ? rx : 0), y);
  ctx.lineTo(x + width - (tail ? rx : 0), y);
  if (tail) {
    ctx.ellipse(x + width - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
    ctx.lineTo(x + width, y + height - ry);
    ctx.ellipse(x + width - rx, y + height - ry, rx, ry, 0, 0, Math.PI / 2);
  } else ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + (head ? rx : 0), y + height);
  if (head) {
    ctx.ellipse(x + rx, y + height - ry, rx, ry, 0, Math.PI / 2, Math.PI);
    ctx.lineTo(x, y + ry);
    ctx.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
  } else ctx.lineTo(x, y);
  ctx.closePath();
}

export function e235DoorFrame(time: number) {
  const phase = (time % 6000) / 1000;
  return {
    width: 120 + 80 * Math.max(0, Math.min(1, (phase - 1) / 2)),
    arrowY: phase < 3 ? 120 : phase < 4 ? 100 * (4 - phase) : 0,
  };
}
function door(ctx: CanvasRenderingContext2D, model: ScreenSchedule, time: number) {
  const near = thisSide(model),
    blue = near ? '#0d50a6' : '#000000';
  ctx.fillStyle = blue;
  ctx.fillRect(0, 400, 960, 140);
  polygon(
    ctx,
    [
      [115, 527],
      [133, 515],
      [257, 515],
      [275, 527],
    ],
    '#c0c000',
  );
  const frame = e235DoorFrame(time),
    width = near ? frame.width : 120;
  for (const [index, x] of [195 - width / 2, 195 + width / 2 - 60].entries()) {
    ctx.fillStyle = '#e6ebf0';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, 410.5, 59, 104, 2.5);
    ctx.fill();
    ctx.stroke();
    const seam = ctx.createLinearGradient(index ? x + 5 : x + 55, 0, index ? x + 1 : x + 59, 0);
    seam.addColorStop(0.2, '#e6ebf04f');
    seam.addColorStop(0.4, '#d0d000');
    ctx.fillStyle = seam;
    ctx.fillRect(index ? x + 1 : x + 55, 411, 4, 103);
    const foot = ctx.createLinearGradient(0, 494, 0, 514);
    foot.addColorStop(0, '#e6ebf04f');
    foot.addColorStop(0.05, '#b0c0d05f');
    foot.addColorStop(0.5, '#b0c0d0df');
    foot.addColorStop(0.55, '#7a90a0ef');
    ctx.fillStyle = foot;
    ctx.fillRect(x + 1, 494, 58, 20);
    // The inner WPF Border starts after the leaf's 1px border and its 8px top margin.
    const window = ctx.createLinearGradient(x + 12.4, 419, x + 47.6, 471);
    window.addColorStop(0.4, blue);
    window.addColorStop(1, near ? '#d0edff' : '#d0e0ff');
    ctx.fillStyle = window;
    ctx.beginPath();
    ctx.roundRect(x + 8.5, 419.5, 43, 51, 2.5);
    ctx.fill();
    ctx.stroke();
  }
  if (near) {
    for (const sign of [-1, 1]) {
      ctx.save();
      ctx.translate(195 + sign * (width / 2 + 34), 462.5);
      ctx.scale(-sign, 1);
      polygon(
        ctx,
        [
          [0, 0],
          [12, -13],
          [12, -7],
          [26, -7],
          [26, 7],
          [12, 7],
          [12, 13],
        ],
        '#ffffff',
      );
      ctx.restore();
    }
    const y = 498 + frame.arrowY;
    polygon(
      ctx,
      [
        [163.5, y + 21],
        [195, y],
        [226.5, y + 21],
      ],
      '#ffffff',
    );
    polygon(
      ctx,
      [
        [168, y + 19.6],
        [195, y + 1.6],
        [222, y + 19.6],
      ],
      '#d00000',
    );
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(195, 468, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d00000';
    ctx.beginPath();
    ctx.arc(195, 468, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(177, 464, 36, 8);
  }
  label(
    ctx,
    near ? 'こちら側のドアが開きます' : '反対側のドアが開きます',
    390,
    468,
    52,
    0,
    '#ffffff',
    UI,
  );
  label(
    ctx,
    near ? 'Doors on this side will open.' : 'Doors on the opposite side will open.',
    near ? 440 : 395,
    499,
    28,
    0,
    '#ffffff',
  );
}

function notice(ctx: CanvasRenderingContext2D, en: boolean) {
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 15;
  ctx.strokeRect(7.5, 167.5, 945, 365);
  const title = en ? 'Security Notice' : '特別警戒実施のお知らせ';
  label(
    ctx,
    title,
    480,
    en ? 219 : 215,
    en ? 42 : 34,
    en ? 0 : 340,
    '#ff0000',
    en ? 'Arial' : JA,
    700,
    'center',
  );
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(en ? 318 : 298, en ? 227 : 222, en ? 324 : 364, en ? 3 : 2);
  const lines = en
    ? [
        'JR East Group and the Police Department together are',
        'now on |a high alert|.',
        'If you find |something suspicious| at a station or on a train,',
        'please inform station staff, conductors or security guards',
        'as soon as possible.',
      ]
    : [
        'ただいま、JR 東日本グループでは、警察と連携し、|特別警戒|を実施して',
        'おります。防犯カメラを駅構内に設置しているほか、社員および警備員による',
        '駅構内・列車内の巡回を強化して、お客さまに安心してご利用いただけるよう',
        'に努めております。',
        '駅構内で|不審物や気がかりなこと|がございましたら、お近くの駅係員、車掌',
        'または警備員までお知らせください。お客さまのご協力をお願いいたします。',
      ];
  const size = en ? 32 : 25,
    family = en ? 'Arial' : JA;
  const runs = lines.map((line) =>
    line.split('|').flatMap((part, index) =>
      (en ? [part] : part.split(/(JR)/)).filter(Boolean).map((value) => ({
        value,
        family: !en && value === 'JR' ? SANS : family,
        color: index % 2 ? '#ff0000' : '#000000',
      })),
    ),
  );
  const measure = (run: (typeof runs)[number][number]) => {
    ctx.font = `700 ${size}px ${run.family}`;
    return ctx.measureText(run.value).width;
  };
  const width = Math.max(...runs.map((line) => line.reduce((sum, run) => sum + measure(run), 0)));
  const scale = Math.min(1, (en ? 882 : 884) / width);
  ctx.save();
  ctx.translate((960 - width * scale) / 2, en ? 283 : 273);
  ctx.scale(scale, en ? 1 : 270 / 252);
  runs.forEach((line, i) => {
    let x = 0;
    line.forEach((run) => {
      label(ctx, run.value, x, i * (en ? 48 : 42), size, 0, run.color, run.family, 700);
      x += measure(run);
    });
  });
  ctx.restore();
}

export function drawE235Page(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  if (model.page === 'door' || model.page === 'platform' || model.page === 'closing') {
    drawE235Platform(ctx, model);
    if (model.page === 'platform') {
      transferGrid(ctx, model, 'Platform');
      const station = e235Station(target(model)),
        stop = stopFor(model),
        info = station.platformInfos.find((i) => i.ref === stop.platformRef);
      if (info) {
        label(
          ctx,
          `${info.updateYear}年${info.updateMonth}月現在`,
          950,
          518,
          15,
          0,
          '#000000',
          UI,
          400,
          'right',
        );
        label(
          ctx,
          `As of ${info.updateMonthEnglish}, ${info.updateYearEnglish}`,
          950,
          536,
          15,
          0,
          '#000000',
          SANS,
          400,
          'right',
        );
      }
    }
  } else if (model.page === 'transfers') {
    ctx.fillStyle = '#dae0f0';
    ctx.fillRect(0, 160, 960, 34);
    label(ctx, 'のりかえ案内', 490, 185, 22, 0, '#000000', JA, 400, 'right');
    label(ctx, 'Transfer', 512, 185, 24);
    transferGrid(ctx, model, 'Transfers');
  } else if (model.page === 'notice') notice(ctx, model.language === 'en');
  else if (model.page === 'priority') {
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(190.5, 165.5, 579, 327, 8);
    ctx.stroke();
    e235Images.draw(ctx, 'PrioritySeat', 195, 170, 572, (572 * 445.66898) / 800);
    label(
      ctx,
      '優先席を必要とされるお客さまがいらっしゃいましたら、席をお譲りください。',
      480,
      516,
      18,
      580,
      '#000000',
      JA,
      400,
      'center',
    );
    label(
      ctx,
      'Please offer your seat to those who may need it.',
      480,
      533,
      14,
      0,
      '#000000',
      SANS,
      400,
      'center',
    );
  } else if (model.page === 'mobile') {
    e235Images.draw(ctx, 'MobilePhone', 110, 245, 240, (240 * 349.633) / 400);
    ctx.font = `42px ${JA}`;
    const textWidth = Math.max(
      ctx.measureText('マナーモードに設定の上、').width,
      ctx.measureText('通話はご遠慮ください。').width,
    );
    ctx.save();
    ctx.translate(410, 278);
    ctx.scale(Math.min(1, 400 / textWidth), 0.8);
    label(ctx, 'マナーモードに設定の上、', 0, 36, 42, 0, '#000000', JA);
    label(ctx, '通話はご遠慮ください。', 0, 86, 42, 0, '#000000', JA);
    ctx.restore();
    label(ctx, 'Please set your mobile phone to silent mode', 410, 393, 22, 500);
    label(ctx, 'and refrain from talking on the phone.', 410, 419, 22, 500);
  }
}
export function drawE235PageOverlay(
  ctx: CanvasRenderingContext2D,
  model: ScreenSchedule,
  time: number,
) {
  if (model.page === 'door' || model.page === 'closing') {
    door(ctx, model, time);
    return thisSide(model) || e235Images.pending;
  }
  return (
    e235Images.pending ||
    (e235Station(target(model)).transfers.some((t) => t.icons.length > 1) &&
      ['nearby', 'transfers', 'platform'].includes(model.page))
  );
}

import type { ScreenSchedule } from '../../rendering/screens';
import { e235Station, e235TransferLayout } from './data';
import { JA, SANS, label, polygon } from './page-draw';
import { target } from './stop';

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

import type { ScreenSchedule } from '../../rendering/screens';
import type { StationDefinition } from '../../simulation/lines';
import { drawFittedText, drawBadge } from './text';
import { C, HEADER_BOTTOM, LATIN_FONT, HIBIYA_PANEL_WIDTH } from './layout';
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
  TX: {
    code: 'TX',
    color: '#263642',
    ja: 'つくばエクスプレス',
    en: 'Tsukuba Express',
    square: true,
  },
  TS: {
    code: 'TS',
    color: '#0089c4',
    ja: '東武スカイツリーライン',
    en: 'Tobu Skytree Line',
    square: true,
  },
};

export function routeTransfers(station: StationDefinition): TransferSign[] {
  return station.transfers
    .flatMap((item) => {
      if (item.kind === 'badge') {
        const prefix = item.code.replace(/\d+$/, '');
        return [
          TRANSFERS[prefix] ?? {
            code: prefix,
            color: '#263642',
            ja: prefix,
            en: prefix,
            square: true,
          },
        ];
      }
      return (item.names.ja ?? item.names.en ?? '')
        .split(/[・、,]/)
        .filter(Boolean)
        .map((ja) =>
          ja.includes('つくば')
            ? TRANSFERS.TX
            : {
                code: ja.includes('JR') ? 'JR' : '',
                color: ja.includes('京成') ? '#277ca3' : '#2b7364',
                ja,
                en: item.names.en ?? ja,
                square: true,
              },
        );
    })
    .filter((item, index, list) => list.findIndex((sign) => sign.ja === item.ja) === index);
}

export function drawTransferSymbol(
  ctx: CanvasRenderingContext2D,
  sign: TransferSign,
  x: number,
  y: number,
  size: number,
): void {
  if (!sign.square) {
    drawBadge(ctx, sign.code, x, y, size, sign.color);
    return;
  }
  ctx.fillStyle = sign.color;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = C.white;
  ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
  drawFittedText(
    ctx,
    sign.code || '↔',
    x + size / 2,
    y + size / 2,
    size - 3,
    size * 0.64,
    8,
    sign.color,
    700,
    LATIN_FONT,
    'center',
  );
}

export function drawTransferDetail(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body;
  ctx.fillRect(0, HEADER_BOTTOM, HIBIYA_PANEL_WIDTH, 720 - HEADER_BOTTOM);
  ctx.fillStyle = '#e3e4de';
  ctx.fillRect(0, HEADER_BOTTOM, HIBIYA_PANEL_WIDTH, 52);
  drawFittedText(ctx, 'のりかえのご案内 / Transfer information', 30, 268, 1220, 32, 24, C.ink, 500);
  routeTransfers(model.transferStation)
    .slice(0, 5)
    .forEach((sign, index) => {
      const y = 324 + index * 74;
      drawTransferSymbol(ctx, sign, 56, y, 52);
      drawFittedText(ctx, sign.ja, 132, y + 14, 1060, 36, 24, C.ink, 700);
      drawFittedText(ctx, sign.en, 132, y + 48, 1060, 28, 18, C.ink, 500, LATIN_FONT);
    });
}

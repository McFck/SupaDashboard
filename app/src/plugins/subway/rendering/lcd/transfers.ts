import type { ScreenSchedule } from '../screens';

export type TransferSign = {
  code: string;
  color: string;
  ja: string;
  en: string;
  circle?: boolean;
  train?: boolean;
};
const signs: TransferSign[] = [
  { code: 'JC', color: '#ef8027', ja: '中央線', en: 'Chūō Line' },
  { code: 'JB', color: '#e8d832', ja: '中央線各駅停車', en: 'Chūō Line (Local)' },
  { code: 'JS', color: '#e21c35', ja: '湘南新宿ライン', en: 'Shōnan-Shinjuku Line' },
  { code: 'JA', color: '#00a499', ja: '埼京線', en: 'Saikyō Line' },
  { code: '', color: '#15191b', ja: '小田急線', en: 'Odakyū Line', train: true },
  { code: '', color: '#15191b', ja: '京王線', en: 'Keiō Line', train: true },
  { code: 'M', color: '#e60020', ja: '丸ノ内線', en: 'Marunouchi Line', circle: true },
  { code: 'S', color: '#80b52b', ja: '都営新宿線', en: 'Toei Shinjuku Line', circle: true },
  { code: 'E', color: '#c60072', ja: '都営大江戸線', en: 'Toei Ōedo Line', circle: true },
  { code: 'JK', color: '#00a6d4', ja: '京浜東北線', en: 'Keihin-Tōhoku Line' },
  { code: 'JT', color: '#f18923', ja: '東海道線', en: 'Tōkaidō Line' },
  { code: 'JO', color: '#0669b2', ja: '横須賀線・総武線快速', en: 'Yokosuka / Sōbu Line (Rapid)' },
  { code: 'JE', color: '#c92442', ja: '京葉線', en: 'Keiyō Line' },
  { code: 'JU', color: '#f18923', ja: '上野東京ライン', en: 'Ueno-Tōkyō Line' },
  { code: 'H', color: '#9caeb7', ja: '日比谷線', en: 'Hibiya Line', circle: true },
  { code: 'G', color: '#f39800', ja: '銀座線', en: 'Ginza Line', circle: true },
  { code: 'Y', color: '#c7af68', ja: '有楽町線', en: 'Yūrakuchō Line', circle: true },
];

export function transferSigns(model: ScreenSchedule): TransferSign[] {
  // The user's Shinjuku LCD photograph explicitly documents these nine connections.
  if (model.transferStation.code === 'JY17') return signs.slice(0, 9);
  const result: TransferSign[] = [];
  for (const transfer of model.transferStation.transfers) {
    if (transfer.kind === 'badge') {
      const code = transfer.code.replace(/\d+$/, '');
      result.push(
        signs.find((sign) => sign.code === code) ?? { code, color: '#526e82', ja: code, en: code },
      );
    } else {
      const japanese = (transfer.names.ja ?? '').split(/[、,]/).filter(Boolean);
      const english = (transfer.names.en ?? '').split(',').map((text) => text.trim());
      japanese.forEach((ja, index) =>
        result.push(
          signs.find((sign) => ja.includes(sign.ja)) ?? {
            code: '',
            color: '#26313b',
            ja,
            en: english[index] ?? '',
            train: true,
          },
        ),
      );
    }
  }
  return result.filter((sign, index) => result.findIndex((item) => item.ja === sign.ja) === index);
}

function symbolText(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  ctx.font = `700 ${size}px Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

/** Line symbol as printed on JR East LCDs: JR codes in a coloured frame, subway letters in a coloured disc, private railways as a train glyph. */
export function drawLineSymbol(
  ctx: CanvasRenderingContext2D,
  sign: TransferSign,
  x: number,
  y: number,
  size: number,
) {
  if (sign.circle) {
    ctx.fillStyle = sign.color;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size * 0.34, 0, Math.PI * 2);
    ctx.fill();
    symbolText(ctx, sign.code, x + size / 2, y + size / 2 + 1, size * 0.46, sign.color);
  } else if (sign.train || !sign.code) {
    ctx.fillStyle = sign.color;
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, size * 0.12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(x + size * 0.28, y + size * 0.16, size * 0.44, size * 0.52, size * 0.1);
    ctx.fill();
    ctx.fillStyle = sign.color;
    ctx.fillRect(x + size * 0.34, y + size * 0.24, size * 0.32, size * 0.18);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + size * 0.26, y + size * 0.74, size * 0.1, size * 0.12);
    ctx.fillRect(x + size * 0.64, y + size * 0.74, size * 0.1, size * 0.12);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = sign.color;
    ctx.lineWidth = Math.max(2, size * 0.09);
    ctx.strokeRect(
      x + ctx.lineWidth / 2,
      y + ctx.lineWidth / 2,
      size - ctx.lineWidth,
      size - ctx.lineWidth,
    );
    symbolText(ctx, sign.code, x + size / 2, y + size / 2 + 1, size * 0.5, '#1d2124');
  }
}

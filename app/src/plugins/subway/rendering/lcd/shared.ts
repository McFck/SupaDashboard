import type { StationDefinition } from '../../simulation/lines';
import type { ScreenLanguage } from '../screens';

export const JAPANESE_FONT = '"Yu Gothic UI", Meiryo, "Noto Sans JP", sans-serif';

export function drawFacilitySymbol(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, size = 56) {
  ctx.save(); ctx.translate(x - size / 2, y - size / 2); ctx.scale(size / 56, size / 56);
  ctx.fillStyle = '#f8fafb'; ctx.strokeStyle = '#f8fafb'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
  if (kind === 'stairs') {
    ctx.beginPath(); ctx.moveTo(4, 50);
    for (let i=0;i<5;i++) { ctx.lineTo(4+i*10, 42-i*8); ctx.lineTo(14+i*10,42-i*8); }
    ctx.stroke(); ctx.beginPath(); ctx.moveTo(4, 30); ctx.lineTo(48, 4); ctx.stroke();
  } else if (kind === 'escalator') {
    ctx.beginPath(); ctx.moveTo(5, 42); ctx.lineTo(16, 42); ctx.lineTo(40, 14); ctx.lineTo(51, 14);
    ctx.lineTo(51, 25); ctx.lineTo(44, 25); ctx.lineTo(20, 53); ctx.lineTo(5, 53); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(27, 13, 5, 0, Math.PI*2); ctx.fill(); ctx.fillRect(24, 21, 6, 13);
  } else if (kind === 'lift') {
    ctx.strokeRect(10, 16, 36, 38);
    for (const px of [22,34]) { ctx.beginPath(); ctx.arc(px, 28, 4, 0, Math.PI*2); ctx.fill(); ctx.fillRect(px-3, 35, 6, 14); }
    ctx.beginPath(); ctx.moveTo(14, 10); ctx.lineTo(20, 4); ctx.lineTo(26, 10); ctx.moveTo(30, 4); ctx.lineTo(36, 10); ctx.lineTo(42, 4); ctx.stroke();
  } else if (kind === 'toilet') {
    for (const px of [15,41]) { ctx.beginPath(); ctx.arc(px, 10, 5, 0, Math.PI*2); ctx.fill(); ctx.fillRect(px-5, 20, 10, 20); ctx.fillRect(px-5, 40, 4, 14); ctx.fillRect(px+1, 40, 4, 14); }
  } else {
    ctx.strokeRect(30, 6, 20, 46); ctx.beginPath(); ctx.moveTo(2, 28); ctx.lineTo(36, 28);
    ctx.moveTo(25, 18); ctx.lineTo(36, 28); ctx.lineTo(25, 38); ctx.stroke();
  }
  ctx.restore();
}

export const E235_COLORS = Object.freeze({
  header: '#15191b', route: '#79b52c', body: '#fafafa', passed: '#adb0b3', doorPanel: '#164b8a',
  exit: '#f4e666', currentCar: '#cb292d', ink: '#202629', muted: '#687176', white: '#ffffff',
});

export function fittedFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxSize: number,
  minSize: number, weight = 700, family = JAPANESE_FONT): string {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return `${weight} ${Math.max(minSize, size)}px ${family}`;
}

export function drawFittedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number,
  maxSize: number, minSize: number, color: string, weight = 700, family = JAPANESE_FONT, align: CanvasTextAlign = 'left'): void {
  ctx.font = fittedFont(ctx, text, maxWidth, maxSize, minSize, weight, family);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y, maxWidth);
}

export function drawBadge(ctx: CanvasRenderingContext2D, code: string, x: number, y: number, size: number, color: string): void {
  const circular = /^[A-Z]{1,2}\d{1,2}$/.test(code) && !code.startsWith('JY');
  ctx.fillStyle = color;
  if (circular) {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#ffffff';
  if (circular) {
    ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size * .37, 0, Math.PI * 2); ctx.fill();
  } else ctx.fillRect(x + size * .13, y + size * .13, size * .74, size * .74);
  const parts = code.match(/^([A-Z]+)(\d+)$/);
  ctx.fillStyle = '#202629';
  ctx.font = `700 ${Math.max(8, size * (parts ? .27 : .34))}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(parts?.[1] ?? code, x + size / 2, y + size * (parts ? .34 : .5), size * .7);
  if (parts) {
    ctx.font = `700 ${Math.max(8, size * .36)}px Arial, sans-serif`;
    ctx.fillText(parts[2], x + size / 2, y + size * .64, size * .68);
  }
}

export function drawStationName(ctx: CanvasRenderingContext2D, station: StationDefinition, language: ScreenLanguage,
  x: number, y: number, maxWidth: number, maxSize: number, minSize: number, color: string = E235_COLORS.ink,
  align: CanvasTextAlign = 'left'): void {
  const text = station.names[language] ?? station.names.ja ?? station.names.en ?? station.code;
  const family = language === 'ja' || language === 'kana' || language === 'zh' ? JAPANESE_FONT : 'Arial, sans-serif';
  drawFittedText(ctx, text, x, y, maxWidth, maxSize, minSize, color, 700, family, align);
}

export class CanvasLayerCache {
  private readonly layers = new Map<string, HTMLCanvasElement>();
  constructor(private readonly limit = 12) {}

  draw(ctx: CanvasRenderingContext2D, key: string, width: number, height: number,
    render: (ctx: CanvasRenderingContext2D) => void): boolean {
    if (typeof document === 'undefined') return false;
    const transform = ctx.getTransform();
    const density = Math.min(2, Math.max(1, Math.hypot(transform.a, transform.b)));
    key = `${key}@${density.toFixed(3)}`;
    let layer = this.layers.get(key);
    if (layer) {
      this.layers.delete(key);
      this.layers.set(key, layer);
    } else {
      layer = document.createElement('canvas');
      layer.width = Math.ceil(width * density);
      layer.height = Math.ceil(height * density);
      const layerContext = layer.getContext('2d');
      if (!layerContext) return false;
      layerContext.scale(layer.width / width, layer.height / height);
      render(layerContext);
      this.layers.set(key, layer);
      while (this.layers.size > this.limit) this.layers.delete(this.layers.keys().next().value!);
    }
    ctx.drawImage(layer, 0, 0, width, height);
    return true;
  }

  get size(): number { return this.layers.size; }
  clear(): void { this.layers.clear(); }
}

export function transfersKey(station: StationDefinition): string {
  return station.transfers.map(transfer => transfer.kind === 'badge'
    ? transfer.code
    : Object.entries(transfer.names).sort(([a], [b]) => a.localeCompare(b)).map(([language, name]) => `${language}:${name}`).join('/')).join('|');
}

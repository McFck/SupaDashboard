import type { StationDefinition } from '../lines';
import type { ScreenLanguage } from '../screens';

export const E235_COLORS = Object.freeze({
  header: '#15191b', route: '#79b52c', body: '#fafafa', passed: '#adb0b3', doorPanel: '#164b8a',
  exit: '#f4e666', currentCar: '#cb292d', ink: '#202629', muted: '#687176', white: '#ffffff',
});

export function fittedFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxSize: number,
  minSize: number, weight = 700, family = 'Arial, sans-serif'): string {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return `${weight} ${Math.max(minSize, size)}px ${family}`;
}

export function drawFittedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number,
  maxSize: number, minSize: number, color: string, weight = 700, family = 'Arial, sans-serif', align: CanvasTextAlign = 'left'): void {
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
  ctx.font = `700 ${Math.max(8, size * 0.34)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(code, x + size / 2, y + size / 2, size - 4);
}

export function drawStationName(ctx: CanvasRenderingContext2D, station: StationDefinition, language: ScreenLanguage,
  x: number, y: number, maxWidth: number, maxSize: number, minSize: number, color = E235_COLORS.ink,
  align: CanvasTextAlign = 'left'): void {
  const text = station.names[language] ?? station.names.ja ?? station.names.en ?? station.code;
  const family = language === 'ja' || language === 'zh' ? 'Yu Gothic, Meiryo, sans-serif' : 'Arial, sans-serif';
  drawFittedText(ctx, text, x, y, maxWidth, maxSize, minSize, color, 700, family, align);
}

export function drawProgressBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number,
  progress: number, color = E235_COLORS.route): void {
  ctx.fillStyle = '#d9dde0';
  ctx.fillRect(x, y, width, 6);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width * Math.max(0, Math.min(1, progress)), 6);
}

export class CanvasLayerCache {
  private readonly layers = new Map<string, HTMLCanvasElement>();
  constructor(private readonly limit = 12) {}

  draw(ctx: CanvasRenderingContext2D, key: string, width: number, height: number,
    render: (ctx: CanvasRenderingContext2D) => void): boolean {
    if (typeof document === 'undefined') return false;
    let layer = this.layers.get(key);
    if (layer) {
      this.layers.delete(key);
      this.layers.set(key, layer);
    } else {
      layer = document.createElement('canvas');
      layer.width = width;
      layer.height = height;
      const layerContext = layer.getContext('2d');
      if (!layerContext) return false;
      render(layerContext);
      this.layers.set(key, layer);
      while (this.layers.size > this.limit) this.layers.delete(this.layers.keys().next().value!);
    }
    ctx.drawImage(layer, 0, 0);
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

export const JAPANESE_FONT = '"Yu Gothic UI", Meiryo, "Noto Sans JP", sans-serif';

export const E235_COLORS = Object.freeze({
  header: '#15191b',
  route: '#79b52c',
  body: '#fafafa',
  passed: '#adb0b3',
  doorPanel: '#164b8a',
  exit: '#f4e666',
  currentCar: '#cb292d',
  ink: '#202629',
  muted: '#687176',
  white: '#ffffff',
});

function fittedFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  weight = 700,
  family = JAPANESE_FONT,
): string {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return `${weight} ${Math.max(minSize, size)}px ${family}`;
}

export function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  color: string,
  weight = 700,
  family = JAPANESE_FONT,
  align: CanvasTextAlign = 'left',
): void {
  ctx.font = fittedFont(ctx, text, maxWidth, maxSize, minSize, weight, family);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y, maxWidth);
}

export function drawBadge(
  ctx: CanvasRenderingContext2D,
  code: string,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const circular = /^[A-Z]{1,2}\d{1,2}$/.test(code) && !code.startsWith('JY');
  ctx.fillStyle = color;
  if (circular) {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#ffffff';
  if (circular) {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size * 0.37, 0, Math.PI * 2);
    ctx.fill();
  } else ctx.fillRect(x + size * 0.13, y + size * 0.13, size * 0.74, size * 0.74);
  const parts = code.match(/^([A-Z]+)(\d+)$/);
  ctx.fillStyle = '#202629';
  ctx.font = `700 ${Math.max(8, size * (parts ? 0.27 : 0.34))}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(parts?.[1] ?? code, x + size / 2, y + size * (parts ? 0.34 : 0.5), size * 0.7);
  if (parts) {
    ctx.font = `700 ${Math.max(8, size * 0.36)}px Arial, sans-serif`;
    ctx.fillText(parts[2], x + size / 2, y + size * 0.64, size * 0.68);
  }
}

export class CanvasLayerCache {
  private readonly layers = new Map<string, HTMLCanvasElement>();
  constructor(private readonly limit = 12) {}

  draw(
    ctx: CanvasRenderingContext2D,
    key: string,
    width: number,
    height: number,
    render: (ctx: CanvasRenderingContext2D) => void,
  ): boolean {
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

  get size(): number {
    return this.layers.size;
  }
  clear(): void {
    this.layers.clear();
  }
}

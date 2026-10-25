import { describe, expect, it } from 'vitest';
import { fittedFont } from './shared';
import { isTransferBadge, yamanoteBroadNodePositions, yamanoteLayout } from './yamanote';

describe('E235-0 Yamanote LCD geometry', () => {
  it('keeps the 30 percent header, route separator, body and blue door-panel anchors', () => {
    const layout = yamanoteLayout();
    expect(layout).toMatchObject({ width: 1280, height: 720, header: { height: 216 }, body: { y: 216, height: 504 } });
    expect(layout.direction.width / layout.width).toBeCloseTo(0.2703, 3);
    expect(layout.separator).toEqual({ x: 346, y: 0, width: 22, height: 216 });
    expect(layout.doorPanel).toEqual({ x: 0, y: 520, width: 1280, height: 200 });
  });

  it('places all 30 route nodes inside the LCD and mirrors the loop for reverse travel', () => {
    const inner = yamanoteBroadNodePositions(30, 1);
    const outer = yamanoteBroadNodePositions(30, -1);
    expect(inner).toHaveLength(30);
    expect(outer).toHaveLength(30);
    for (const point of inner) {
      expect(point.x).toBeGreaterThanOrEqual(130);
      expect(point.x).toBeLessThanOrEqual(1150);
      expect(point.y).toBeGreaterThanOrEqual(280);
      expect(point.y).toBeLessThanOrEqual(660);
    }
    for (let index = 0; index < inner.length; index++) {
      expect(outer[index].x).toBeCloseTo(1280 - inner[index].x, 8);
      expect(outer[index].y).toBeCloseTo(inner[index].y, 8);
    }
  });

  it('renders only station codes as badges and leaves transfer prose as text', () => {
    expect(isTransferBadge('G07')).toBe(true);
    expect(isTransferBadge('JY30')).toBe(true);
    expect(isTransferBadge('Keihin-Tohoku, Chuo and Sobu Lines')).toBe(false);
  });

  it('fits long station labels down to the documented minimum before canvas width compression', () => {
    const fake = {
      font: '',
      measureText(this: { font: string }, text: string) {
        const size = Number(this.font.match(/(\d+)px/)?.[1] ?? 1);
        return { width: text.length * size * 0.55 };
      },
    } as unknown as CanvasRenderingContext2D;
    const text = 'A very long station name';
    const font = fittedFont(fake, text, 180, 108, 84);
    expect(Number(font.match(/(\d+)px/)?.[1])).toBeLessThanOrEqual(108);
    expect(Number(font.match(/(\d+)px/)?.[1])).toBeGreaterThanOrEqual(84);
    fake.font = font;
    expect(fake.measureText(text).width).toBeGreaterThan(180);
  });
});

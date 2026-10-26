import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex } from './palette';

describe('hsv conversion', () => {
  it('round-trips the palette and primaries', () => {
    for (const hex of [
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#ffffff',
      '#000000',
      '#67c9eb',
      '#e9c878',
      '#808080',
    ])
      expect(hsvToHex(...(Object.values(hexToHsv(hex)) as [number, number, number]))).toBe(hex);
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('nope')).toEqual({ h: 0, s: 0, v: 0 });
  });
});

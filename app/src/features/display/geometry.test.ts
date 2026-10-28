import { describe, expect, it } from 'vitest';
import { startupPlacement, validGeometry } from './geometry';

describe('dashboard window geometry', () => {

  it('rejects unusable saved sizes and coordinates', () => {
    expect(validGeometry({ x: -1200, y: 100, width: 770, height: 392 })).toBe(true);
    expect(validGeometry({ x: 0, y: 0, width: 0, height: 392 })).toBe(false);
    expect(validGeometry({ x: Number.NaN, y: 0, width: 770, height: 392 })).toBe(false);
  });
});

describe('startup placement', () => {
  const left = {
    name: 'A',
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
    scaleFactor: 1,
  };
  const right = {
    name: 'B',
    position: { x: 1920, y: 0 },
    size: { width: 2560, height: 1440 },
    workArea: { position: { x: 1920, y: 0 }, size: { width: 2560, height: 1400 } },
    scaleFactor: 1.5,
  };
  const screens = [left, right];
  const deck = { cols: 6, rows: 3, size: 112, gap: 14 };
  const actual = { x: 10, y: 10, width: 100, height: 100 };

  it('opens a first launch at the deck size, scaled and centered on the chosen monitor', () => {
    expect(startupPlacement(screens, null, undefined, left, actual, deck)).toEqual({
      monitor: left,
      bounds: { x: 575, y: 324, width: 770, height: 392 },
    });
    expect(startupPlacement(screens, 'B', undefined, left, actual, deck).bounds).toEqual({
      x: 2623,
      y: 406,
      width: 1155,
      height: 588,
    });
  });

  it('reopens saved bounds on the monitor they mostly cover, pulled back inside its work area', () => {
    const saved = { x: 4300, y: -50, width: 800, height: 400 };
    expect(startupPlacement(screens, null, saved, left, actual, deck)).toEqual({
      monitor: right,
      bounds: { x: 3680, y: 0, width: 800, height: 400 },
    });
  });

  it('centers saved bounds on an explicitly chosen monitor other than the saved one', () => {
    const saved = { x: 2000, y: 100, width: 800, height: 400 };
    expect(startupPlacement(screens, 'A', saved, left, actual, deck)).toEqual({
      monitor: left,
      bounds: { x: 560, y: 320, width: 800, height: 400 },
    });
  });

  it('never returns unusable bounds when no monitor is reported', () => {
    const broken = { x: Number.NaN, y: 0, width: 0, height: 0 };
    expect(startupPlacement([], 'A', broken, null, actual, deck).bounds).toEqual(actual);
    expect(startupPlacement([], null, undefined, null, broken, deck).bounds).toEqual({
      x: 0,
      y: 0,
      width: 770,
      height: 392,
    });
  });
});

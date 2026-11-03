import { describe, expect, it } from 'vitest';
import { readAppIcon } from './apps';

const png = [
  ...Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKUlEQVR4AeyTsQkAAAzCgv//bOkNDi4Krg7ByOCkIswGYAzG4DXq/+AAAAD//xTgAbwAAAAGSURBVAMAwoMgAWvW/A4AAAAASUVORK5CYII=',
    ),
    (c) => c.charCodeAt(0),
  ),
];

describe('native app icon boundary', () => {
  it('accepts a bounded PNG and rejects URLs, truncated frames, oversized dimensions and invalid bytes', () => {
    expect(readAppIcon(png)).toMatch(/^data:image\/png;base64,/);
    const huge = [...png];
    huge[16] = 1;
    for (const raw of [
      null,
      'file:///secret',
      '<svg/>',
      png.slice(0, -1),
      [...png, 0],
      huge,
      [...png.slice(0, -1), 256],
      new Array(1024 * 1024 + 1).fill(0),
    ]) {
      expect(readAppIcon(raw)).toBeUndefined();
    }
  });
});

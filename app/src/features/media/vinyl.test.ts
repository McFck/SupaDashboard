import { describe, expect, it } from 'vitest';
import { vinylDesign } from './vinyl';

const tracks = Array.from({ length: 400 }, (_, i) => [`Track ${i}`, `Artist ${i % 37}`] as const);

describe('vinylDesign', () => {
  it('presses the same record for a track after the cache has forgotten it', () => {
    const first = vinylDesign('Kaneda', 'Geinoh Yamashirogumi');
    for (const [title, artist] of tracks.slice(0, 64)) {
      vinylDesign(title, artist);
    }
    const again = vinylDesign('Kaneda', 'Geinoh Yamashirogumi');
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });

  it('keeps every record cheap enough to draw on a small tile', () => {
    for (const [title, artist] of tracks) {
      const design = vinylDesign(title, artist);
      const elements =
        design.under.length + design.rings.length + design.over.length + design.text.length;
      const path = [...design.under, ...design.over].reduce(
        (sum, shape) => sum + shape.d.length,
        0,
      );
      expect(elements).toBeLessThanOrEqual(180);
      expect(path).toBeLessThanOrEqual(40_000);
      expect(JSON.stringify(design)).not.toContain('NaN');
    }
  });
});

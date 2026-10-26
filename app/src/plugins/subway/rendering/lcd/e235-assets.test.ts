import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function fakeImages() {
  const images: FakeImage[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 100;
    naturalHeight = 100;
    src = '';
    constructor() {
      images.push(this);
    }
  }
  vi.stubGlobal('Image', FakeImage);
  return images;
}

it('settles asset readiness when image requests never complete', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const images = fakeImages();
  const module = await import('./e235-pages');
  expect(module.e235AssetsPending()).toBe(true);
  await vi.advanceTimersByTimeAsync(15_000);
  await module.e235AssetsReady;
  expect(module.e235AssetsPending()).toBe(false);
  expect(images).toHaveLength(8);
  expect(
    images.every((image) => image.onload === null && image.onerror === null && image.src === ''),
  ).toBe(true);
});

it('settles readiness even if SVG raster inspection throws', async () => {
  vi.resetModules();
  const images = fakeImages();
  vi.stubGlobal('document', {
    createElement() {
      throw new Error('Canvas unavailable');
    },
  });
  const module = await import('./e235-pages');
  for (const image of images) image.onload?.();
  await module.e235AssetsReady;
  expect(module.e235AssetsPending()).toBe(false);
});

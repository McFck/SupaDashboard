import { expect, it } from 'vitest';
import catalog from '../../plugins/catalog.json';
import { spotifyPlugin } from '../../plugins/spotify';

it('keeps the Spotify marketplace entry consistent with its bundled plugin metadata', () => {
  const metadata = Object.fromEntries(
    (['id', 'title', 'author', 'icon', 'description'] as const).map((key) => [
      key,
      spotifyPlugin[key],
    ]),
  );
  expect(catalog.find((entry) => entry.id === spotifyPlugin.id)).toEqual(metadata);
});

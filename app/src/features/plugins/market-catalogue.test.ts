// Prevents corrupt or unvalidated localStorage catalogue entries from rendering or breaking Market startup.
import { describe, expect, it } from 'vitest';
import { readCachedCatalogue, writeCachedCatalogue } from './market-catalogue.svelte';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

const rawEntry = {
  id: 'clock',
  title: 'World clock',
  description: 'Clocks for the cities you choose.',
  icon: 'Clock',
  version: '2.0.0',
  api: 2,
  published: '2026-11-08',
  size: 1024,
  source: 'https://github.com/McFck/supadashboard-plugins',
  guide: '',
  permissions: {
    http: ['api.example.com'],
    oauth: {
      clock: {
        authorize: 'https://login.example.com/a',
        token: 'https://login.example.com/t',
        redirect: 'http://127.0.0.1',
        scopes: [],
        send: [],
      },
    },
  },
};

describe('market catalogue cache', () => {
  it('round-trips valid entries with logins and drops malformed or unsafe cached data', () => {
    const storage = memoryStorage();
    expect(readCachedCatalogue(storage)).toBeNull();

    writeCachedCatalogue(storage, [rawEntry]);
    const restored = readCachedCatalogue(storage);
    expect(restored).toHaveLength(1);
    expect(restored?.[0]).toMatchObject({
      id: 'clock',
      title: 'World clock',
      permissions: {
        http: ['api.example.com'],
        logins: [
          expect.objectContaining({ name: 'clock', authorize: 'https://login.example.com/a' }),
        ],
      },
    });

    storage.setItem('market-catalogue-v1', '{broken');
    expect(readCachedCatalogue(storage)).toBeNull();

    storage.setItem(
      'market-catalogue-v1',
      JSON.stringify({
        entries: [
          rawEntry,
          { ...rawEntry, id: 'bad', source: 'javascript:alert(1)' },
          { ...rawEntry, id: '../escape' },
        ],
      }),
    );
    expect(readCachedCatalogue(storage)?.map((entry) => entry.id)).toEqual(['clock']);

    const emptyStorage = memoryStorage();
    writeCachedCatalogue(emptyStorage, []);
    expect(readCachedCatalogue(emptyStorage)).toBeNull();
  });
});

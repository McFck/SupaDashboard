import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { acceptRuntimeSnapshot } from './client';
import { runtimeView } from './state';

const snapshot = (activePage: string) => ({
  activePage,
  variables: { revision: 0, records: {} },
  busy: {},
});

describe('runtime mirror', () => {
  it('ignores malformed, stale and replayed owner snapshots', () => {
    acceptRuntimeSnapshot(snapshot('page-2'), 10);
    for (const [value, revision] of [
      [snapshot('page-3'), 10],
      [snapshot('page-3'), 9],
      [snapshot('page-3'), Number.NaN],
      [{ ...snapshot('page-3'), activePage: 3 }, 11],
      [{ ...snapshot('page-3'), variables: null }, 11],
      [{ activePage: 'page-3', variables: { records: {} } }, 11],
      ['page-3', 11],
    ] as const) {
      acceptRuntimeSnapshot(value, revision);
    }
    expect(get(runtimeView)).toMatchObject({ activePage: 'page-2', revision: 10, owner: false });
  });
});

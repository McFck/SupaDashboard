import { describe, expect, it } from 'vitest';
import { listedPlugins, pluginExport } from './load';

describe('external plugin boundary', () => {
  it('installs only a well-formed export of the folder it was loaded from', () => {
    const setup = () => {};
    expect(pluginExport('spike', { id: 'spike', title: 'Spike', setup }).id).toBe('spike');
    for (const value of [
      undefined,
      null,
      'spike',
      { id: 'other', title: 'Spike', setup },
      { id: 'spike', setup },
      { id: 'spike', title: 'Spike', setup: 'run' },
    ]) {
      expect(() => pluginExport('spike', value)).toThrow();
    }
  });

  it('never builds a plugin URL from a malformed native entry', () => {
    expect(() => listedPlugins({})).toThrow();
    expect(
      listedPlugins([
        { id: 'spike', api: 1 },
        { id: '../x', api: 1 },
        { id: 'a/b', api: 1 },
        { id: 'ok', api: '1' },
        null,
      ]),
    ).toEqual([{ id: 'spike', api: 1 }]);
  });
});

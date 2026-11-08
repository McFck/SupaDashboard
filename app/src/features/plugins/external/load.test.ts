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

  it('never builds a plugin URL or a trust badge from a malformed native entry', () => {
    const spike = { id: 'spike', version: '1.0.0', api: 1, trust: 'verified', size: 3, updated: 0 };
    const native = { ...spike, id: 'haptics', api: null, trust: 'unverified' };
    expect(() => listedPlugins({})).toThrow();
    expect(
      listedPlugins([
        spike,
        native,
        { ...spike, id: '../x' },
        { ...spike, id: 'a/b' },
        { ...spike, api: '1' },
        { ...spike, trust: 'tampered' },
        { ...spike, version: undefined },
        null,
      ]),
    ).toEqual([spike, native]);
  });
});

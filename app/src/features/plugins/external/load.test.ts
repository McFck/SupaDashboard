import { describe, expect, it } from 'vitest';
import { permissionRows } from '../permissions';
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
    const spike = {
      id: 'spike',
      version: '1.0.0',
      api: 1,
      trust: 'verified',
      permissions: { http: ['example.com'] },
      size: 3,
      updated: 0,
    };
    expect(() => listedPlugins({})).toThrow();
    const listed = listedPlugins([
      spike,
      { ...spike, id: '../x' },
      { ...spike, id: 'a/b' },
      { ...spike, api: '1' },
      { ...spike, api: null },
      { ...spike, trust: 'tampered' },
      { ...spike, version: undefined },
      { ...spike, permissions: undefined },
      { ...spike, newPermissions: { displays: 'true' } },
      null,
    ]);
    expect(listed.map((entry) => [entry.id, entry.permissions.http])).toEqual([
      ['spike', ['example.com']],
    ]);
  });

  it('keeps pending metadata and shows only the new permissions in the consent dialog', () => {
    const [plugin] = listedPlugins([
      {
        id: 'spike',
        version: '2.0.0',
        api: 2,
        trust: 'verified',
        permissions: { http: ['example.com'], displays: true },
        newPermissions: { displays: true },
        size: 3,
        updated: 0,
      },
    ]);
    expect(plugin.consent?.added).toEqual({ displays: true });
    expect(plugin.consent && permissionRows(plugin.consent.permissions, true)).toEqual([
      { label: 'Displays', value: 'Names and geometry' },
    ]);
  });

  it('shows browser control only for a valid extension grant', () => {
    const browser = 'cnojhdmglpjodgblffallbibdifemkop';
    const entry = {
      id: 'webcompanion',
      version: '0.1.0',
      api: 2,
      trust: 'dev',
      size: 0,
      updated: 0,
    };
    const rows = listedPlugins([
      { ...entry, permissions: { browser } },
      { ...entry, permissions: { browser: `chrome-extension://${browser}` } },
    ]).flatMap((plugin) => permissionRows(plugin.permissions));
    expect(rows).toEqual([{ label: 'Browser control', value: 'Paired browser extension' }]);
  });
});

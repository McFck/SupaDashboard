import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './defaults';
import { migrate } from './normalize';

describe('saved apps', () => {
  it('adds the manual app list when upgrading v10 and refuses a damaged one', () => {
    const { apps: _apps, ...v10 } = { ...structuredClone(DEFAULTS), version: 10 } as any;
    expect(migrate(v10).apps).toEqual([]);
    expect(migrate({ ...v10, version: 11, apps: ['exe:C:\a.exe', 'exe:C:\a.exe'] }).apps).toEqual([
      'exe:C:\a.exe',
    ]);
    expect(() => migrate({ ...v10, version: 11, apps: [1] })).toThrow('apps');
  });
});

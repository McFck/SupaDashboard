import { describe, expect, it } from 'vitest';
import {
  nextSkinSettings,
  resolveSkinConfig,
  validSkinParam,
  validateSkinDefinition,
} from './definition';
import { type SkinDef } from './contracts';
import type { Param } from '../plugins/contracts';

const base = (): SkinDef => ({
  id: 'sample',
  title: 'Sample',
  component: {} as any,
  slots: [{ id: 'main', style: 'region', kind: 'grid', grid: 'page' }],
  views: [{ id: 'default', title: 'Default', slots: ['main'] }],
  defaultView: 'default',
});

describe('skin declarations', () => {
  it('accepts a complete declaration and rejects duplicate or dangling IDs before registration', () => {
    expect(() => validateSkinDefinition(base())).not.toThrow();
    expect(() =>
      validateSkinDefinition({ ...base(), slots: [...base().slots, base().slots[0]] }),
    ).toThrow('slot IDs');
    expect(() =>
      validateSkinDefinition({
        ...base(),
        views: [{ id: 'other', title: 'Other', slots: ['missing'] }],
      }),
    ).toThrow('slot references');
    expect(() => validateSkinDefinition({ ...base(), defaultView: 'missing' })).toThrow(
      'defaultView',
    );
  });

  it('validates Boolean, numeric and select Param values without changing their types', () => {
    expect(validSkinParam({ key: 'enabled', label: 'Enabled', type: 'boolean' }, true)).toBe(true);
    expect(validSkinParam({ key: 'enabled', label: 'Enabled', type: 'boolean' }, 'true')).toBe(
      false,
    );
    expect(
      validSkinParam(
        {
          key: 'line',
          label: 'Line',
          type: 'select',
          suggestions: [{ value: 'demo', label: 'Demo' }],
        },
        'demo',
      ),
    ).toBe(true);
    expect(
      validSkinParam(
        {
          key: 'line',
          label: 'Line',
          type: 'select',
          suggestions: [{ value: 'demo', label: 'Demo' }],
        },
        'unknown',
      ),
    ).toBe(false);
    expect(
      validSkinParam(
        {
          key: 'target',
          label: 'Target',
          type: 'select',
          suggestions: (args) => [{ value: String(args?.line), label: 'Current line' }],
        },
        'demo',
        { line: 'demo' },
      ),
    ).toBe(true);
  });

  it('resolves valid defaults without mutating or dropping unknown stored settings', () => {
    const skin = {
      ...base(),
      settings: [
        {
          key: 'line',
          label: 'Line',
          type: 'select' as const,
          default: 'demo',
          suggestions: [{ value: 'demo', label: 'Demo' }],
        },
        { key: 'enabled', label: 'Enabled', type: 'boolean' as const, default: false },
      ],
    };
    const stored = { line: 'missing', enabled: true, future: '保留' };
    expect(resolveSkinConfig(skin, stored)).toEqual({
      line: 'demo',
      enabled: true,
      future: '保留',
    });
    expect(stored).toEqual({ line: 'missing', enabled: true, future: '保留' });
  });

  const select = (key: string, suggestions: Param['suggestions'], def?: string): Param => ({
    key,
    label: key,
    type: 'select',
    suggestions,
    default: def,
  });
  const route = [
    select(
      'line',
      [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      'a',
    ),
    select('direction', (args) =>
      args?.line === 'a' ? [{ value: 'inner', label: 'Inner' }] : [{ value: 'up', label: 'Up' }],
    ),
  ];

  it('resolves grouped and flat declarations identically and keeps hidden and unknown stored values', () => {
    const stored = { line: 'b', direction: 'up', corner: 'tl', future: 1 };
    const hidden: Param = { key: 'corner', label: 'Corner', type: 'text', visible: () => false };
    const flat = { ...base(), settings: [...route, hidden] };
    const grouped = {
      ...base(),
      settings: [
        { id: 'route', title: 'Route', params: route },
        { id: 'more', title: 'More', params: [hidden] },
      ],
    };
    expect(resolveSkinConfig(grouped, stored)).toEqual(resolveSkinConfig(flat, stored));
    expect(resolveSkinConfig(grouped, stored)).toMatchObject({ corner: 'tl', future: 1 });
  });

  it('resets a dependent setting its parent change invalidated, and reports no-ops as null', () => {
    const skin = { ...base(), settings: route };
    const stored = { line: 'a', direction: 'inner', future: 1 };
    expect(nextSkinSettings(skin, stored, 'line', 'b')).toEqual({
      line: 'b',
      direction: 'up',
      future: 1,
    });
    expect(nextSkinSettings(skin, stored, 'line', 'a')).toBeNull();
    expect(nextSkinSettings(skin, stored, 'line', 'zzz')).toBeNull();
    expect(stored).toEqual({ line: 'a', direction: 'inner', future: 1 });
  });

  it('rejects duplicate setting keys, duplicate group ids and numbers outside min and max', () => {
    const num: Param = { key: 'volume', label: 'Volume', type: 'number', min: 0, max: 1 };
    expect(validSkinParam(num, 0.5)).toBe(true);
    expect(validSkinParam(num, 2)).toBe(false);
    const group = (id: string, params: Param[]) => ({ id, title: id, params });
    expect(() =>
      validateSkinDefinition({
        ...base(),
        settings: [group('a', [num]), group('b', [num])],
      }),
    ).toThrow('duplicate setting');
    expect(() =>
      validateSkinDefinition({
        ...base(),
        settings: [group('a', [num]), group('a', [{ ...num, key: 'x' }])],
      }),
    ).toThrow('group IDs');
    expect(() => validateSkinDefinition({ ...base(), settings: [{ ...num, min: 2 }] })).toThrow(
      'min above max',
    );
  });
});

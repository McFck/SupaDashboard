import { describe, expect, it } from 'vitest';
import { resolveSkinConfig, validSkinParam, validateSkinDefinition } from './definition';
import { type SkinDef } from './contracts';

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
});

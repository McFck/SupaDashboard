import { describe, expect, it } from 'vitest';
import { validSkinParam, validSkinStateValue, validateSkinDefinition, type SkinDef } from './skins';

const base = (): SkinDef => ({ id: 'sample', title: 'Sample', component: {} as any,
  slots: [{ id: 'main', style: 'region', kind: 'grid', grid: 'page' }],
  views: [{ id: 'default', title: 'Default', slots: ['main'] }], defaultView: 'default' });

describe('skin declarations', () => {
  it('accepts a complete declaration and rejects duplicate or dangling IDs before registration', () => {
    expect(() => validateSkinDefinition(base())).not.toThrow();
    expect(() => validateSkinDefinition(undefined as any)).toThrow('ID and title');
    expect(() => validateSkinDefinition({ ...base(), slots: [...base().slots, base().slots[0]] })).toThrow('slot IDs');
    expect(() => validateSkinDefinition({ ...base(), slots: [{ ...base().slots[0], style: 'overlay' as any }] })).toThrow('style or kind');
    expect(() => validateSkinDefinition({ ...base(), views: [{ id: 'other', title: 'Other', slots: ['missing'] }] }))
      .toThrow('slot references');
    expect(() => validateSkinDefinition({ ...base(), defaultView: 'missing' })).toThrow('defaultView');
  });

  it('requires positive finite geometry and skin-prefixed state/event identifiers', () => {
    expect(() => validateSkinDefinition({ ...base(), design: { width: Infinity, height: 10 } })).toThrow('design dimensions');
    expect(() => validateSkinDefinition({ ...base(), state: [{ key: 'view', type: 'string', initialValue: 'default' }] }))
      .toThrow('state keys');
    expect(() => validateSkinDefinition({ ...base(), events: [{ id: 'other.changed', title: 'Changed' }] }))
      .toThrow('skin-prefixed');
    expect(validSkinStateValue('integer', 2)).toBe(true);
    expect(validSkinStateValue('integer', 2.5)).toBe(false);
  });

  it('validates Boolean, numeric and select Param values without changing their types', () => {
    expect(validSkinParam({ key: 'enabled', label: 'Enabled', type: 'boolean' }, true)).toBe(true);
    expect(validSkinParam({ key: 'enabled', label: 'Enabled', type: 'boolean' }, 'true')).toBe(false);
    expect(validSkinParam({ key: 'line', label: 'Line', type: 'select', suggestions: [{ value: 'demo', label: 'Demo' }] }, 'demo')).toBe(true);
    expect(validSkinParam({ key: 'line', label: 'Line', type: 'select', suggestions: [{ value: 'demo', label: 'Demo' }] }, 'unknown')).toBe(false);
  });
});

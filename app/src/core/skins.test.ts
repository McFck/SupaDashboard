import { describe, expect, it } from 'vitest';
import { fitSkinDesign, mapSkinPoint, resolveQuickActions, resolveSkinConfig, validSkinParam, validSkinStateValue, validateSkinDefinition, type SkinDef } from './skins';

const base = (): SkinDef => ({ id: 'sample', title: 'Sample', component: {} as any,
  slots: [{ id: 'main', style: 'region', kind: 'grid', grid: 'page' }],
  views: [{ id: 'default', title: 'Default', slots: ['main'] }], defaultView: 'default' });

describe('skin declarations', () => {
  it('fits a fixed design without distortion and maps only points inside its letterboxed bounds', () => {
    const fit = fitSkinDesign(1280, 720, 1920, 600)!;
    expect(fit).toEqual({ scale: 2 / 3, offsetX: 0, offsetY: 160 });
    expect(mapSkinPoint(640, 160, 0, 0, fit, 1920, 600)).toEqual({ x: 960, y: 0 });
    expect(mapSkinPoint(640, 159, 0, 0, fit, 1920, 600)).toBeNull();
    expect(fitSkinDesign(0, 720, 1920, 600)).toBeNull();
    expect(fitSkinDesign(Number.NaN, 720, 1920, 600)).toBeNull();
  });

  it('accepts a complete declaration and rejects duplicate or dangling IDs before registration', () => {
    expect(() => validateSkinDefinition(base())).not.toThrow();
    expect(() => validateSkinDefinition(undefined as any)).toThrow('ID and title');
    expect(() => validateSkinDefinition({ ...base(), slots: [...base().slots, base().slots[0]] })).toThrow('slot IDs');
    expect(() => validateSkinDefinition({ ...base(), slots: [{ ...base().slots[0], style: 'overlay' as any }] })).toThrow('style or kind');
    expect(() => validateSkinDefinition({ ...base(), views: [{ id: 'other', title: 'Other', slots: ['missing'] }] }))
      .toThrow('slot references');
    expect(() => validateSkinDefinition({ ...base(), defaultView: 'missing' })).toThrow('defaultView');
    expect(() => validateSkinDefinition({ ...base(), pageNavigation: 'external' as any })).toThrow('pageNavigation');
    expect(() => validateSkinDefinition({ ...base(), pageNavigation: 'skin' })).not.toThrow();
    expect(() => validateSkinDefinition({ ...base(), alters: ['layout', 'logic'] })).not.toThrow();
    expect(() => validateSkinDefinition({ ...base(), alters: ['layout', 'layout'] })).toThrow('alters');
    expect(() => validateSkinDefinition({ ...base(), alters: ['appearance'] as any })).toThrow('alters');
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
    expect(validSkinParam({ key: 'target', label: 'Target', type: 'select', suggestions: args =>
      [{ value: String(args?.line), label: 'Current line' }] }, 'demo', { line: 'demo' })).toBe(true);
    expect(validSkinParam({ key: 'steps', label: 'Steps', type: 'actions' }, [{ id: 'media.toggle' }])).toBe(true);
    expect(validSkinParam({ key: 'steps', label: 'Steps', type: 'actions' }, [{ title: 'Invalid' }])).toBe(false);
  });

  it('resolves valid defaults without mutating or dropping unknown stored settings', () => {
    const skin = { ...base(), settings: [
      { key: 'line', label: 'Line', type: 'select' as const, default: 'demo', suggestions: [{ value: 'demo', label: 'Demo' }] },
      { key: 'enabled', label: 'Enabled', type: 'boolean' as const, default: false },
    ] };
    const stored = { line: 'missing', enabled: true, future: '保留' };
    expect(resolveSkinConfig(skin, stored)).toEqual({ line: 'demo', enabled: true, future: '保留' });
    expect(stored).toEqual({ line: 'missing', enabled: true, future: '保留' });
  });

  it('keeps quick action references visible when their action is unavailable', () => {
    const refs = [{ id: 'sample.available', args: { target: 'demo' } }, { id: 'removed.action' }];
    const available = new Map([['sample.available', { id: 'sample.available', title: 'Available', run: () => {} }]]);
    expect(resolveQuickActions(refs, available)).toEqual([
      { ref: refs[0], action: available.get('sample.available') }, { ref: refs[1], action: undefined },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import type { ActionDef, PluginApi } from '../../core/registry';
import { validateSkinDefinition, type SkinDef } from '../../core/skins';
import { subwayPlugin } from './index';

function collect() {
  const actions = new Map<string, ActionDef>();
  let skin: SkinDef | undefined;
  subwayPlugin.setup({
    registerAction: (action: ActionDef) => { actions.set(action.id, action); },
    registerSkin: (definition: SkinDef) => { skin = definition; },
  } as unknown as PluginApi);
  if (!skin) throw new Error('Subway skin was not registered');
  return { actions, skin };
}

describe('Subway skin registration', () => {
  it('registers the planned host geometry and view slot visibility', () => {
    const { skin } = collect();
    validateSkinDefinition(skin);
    expect(skin.design).toEqual({ width: 1920, height: 1200 });
    expect(skin.slots.find(slot => slot.id === 'strip')?.rect).toEqual({ x: 0, y: 1080, w: 1920, h: 120 });
    expect(skin.slots.find(slot => slot.id === 'strip')).toMatchObject({ max: 8, size: { w: 1, h: 1 } });
    expect(skin.slots.find(slot => slot.id === 'side')).toMatchObject({ max: 2, rect: { x: 1728, y: 64, w: 128, h: 352 } });
    expect(skin.views).toEqual([
      { id: 'display', title: 'Display', slots: ['strip'] },
      { id: 'map', title: 'Map', slots: ['strip'] },
      { id: 'cab', title: 'Run', slots: ['strip', 'side'] },
    ]);
    expect(skin.pageNavigation).toBe('skin');
  });

  it('declares persistent settings, owner projections, events, face-only renderers and required quick actions', () => {
    const { actions, skin } = collect();
    expect(skin.settings?.map(param => param.key)).toEqual([
      'line', 'direction', 'startStation', 'speed', 'displayLanguages', 'announcementLanguages',
      'immersion', 'announcementVolume', 'gesture', 'corner',
    ]);
    expect(skin.state?.map(field => field.key)).toEqual([
      'station', 'next', 'state', 'line', 'direction', 'doorSide', 'speed', 'progress', 'paused', 'immersion',
    ]);
    expect(skin.events?.map(event => event.id)).toEqual([
      'subway.departed', 'subway.arrived', 'subway.stateChanged', 'subway.emergency', 'subway.suspended',
    ]);
    expect(skin.controlSkins?.button?.component).toBeTruthy();
    expect(skin.controlSkins?.slider?.component).toBeTruthy();
    expect(skin.quickActions?.map(action => action.id)).toEqual([
      'subway.line', 'subway.emergency', 'subway.immersion', 'subway.resume',
    ]);
    expect([...actions.keys()]).toEqual([
      'subway.line', 'subway.emergency', 'subway.immersion', 'subway.resume', 'subway.suspend', 'subway.view',
    ]);
  });
});

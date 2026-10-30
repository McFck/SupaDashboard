import { describe, expect, it } from 'vitest';
import type { ActionDef, PluginApi } from '../../features/plugins/contracts';
import { settingParams, validateAppletDefinition } from '../../features/applets/definition';
import type { AppletDef } from '../../features/applets/contracts';
import { subwayPlugin } from './index';

function collect() {
  const actions = new Map<string, ActionDef>();
  let applet: AppletDef | undefined;
  subwayPlugin.setup({
    registerAction: (action: ActionDef) => {
      actions.set(action.id, action);
    },
    registerApplet: (definition: AppletDef) => {
      applet = definition;
    },
    registerVariable: () => {},
  } as unknown as PluginApi);
  if (!applet) throw new Error('Subway applet was not registered');
  return { actions, applet };
}

describe('Subway applet registration', () => {
  it('registers the planned host geometry and view slot visibility', () => {
    const { applet } = collect();
    validateAppletDefinition(applet);
    expect(applet.design).toEqual({ width: 1920, height: 480 });
    expect(applet.slots.find((slot) => slot.id === 'strip')).toMatchObject({
      max: 8,
      accepts: ['button', 'slider'],
    });
    expect(applet.slots.find((slot) => slot.id === 'strip')?.size).toBeUndefined();
    expect(applet.slots.find((slot) => slot.id === 'side')).toMatchObject({
      max: 2,
    });
    expect(applet.views).toEqual([
      { id: 'display', title: 'Display', slots: ['strip'] },
      { id: 'map', title: 'Map', slots: ['strip'] },
      { id: 'cab', title: 'Run', slots: ['strip', 'side'] },
    ]);
  });

  it('declares persistent settings, owner projections, events, face-only renderers and required quick actions', () => {
    const { actions, applet } = collect();
    expect(settingParams(applet.settings).map((param) => param.key)).toEqual([
      'line',
      'direction',
      'startStation',
      'carNumber',
      'screen',
      'speed',
      'displayLanguages',
      'announcementLanguages',
      'immersion',
      'announcementVolume',
    ]);
    expect(applet.state?.map((field) => field.key)).toEqual([
      'station',
      'next',
      'state',
      'line',
      'direction',
      'doorSide',
      'speed',
      'progress',
      'paused',
      'immersion',
      'audioReady',
    ]);
    expect(applet.events?.map((event) => event.id)).toEqual([
      'subway.departed',
      'subway.arrived',
      'subway.stateChanged',
      'subway.emergency',
      'subway.suspended',
    ]);
    expect(applet.controlFaces?.button?.component).toBeTruthy();
    expect(applet.controlFaces?.slider?.component).toBeTruthy();
    expect(applet.quickActions?.map((action) => action.id)).toEqual([
      'subway.line',
      'subway.emergency',
      'subway.immersion',
      'subway.resume',
    ]);
    expect([...actions.keys()]).toEqual([
      'subway.line',
      'subway.emergency',
      'subway.immersion',
      'subway.resume',
      'subway.suspend',
      'subway.view',
    ]);
  });
});

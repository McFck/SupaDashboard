import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { get } from 'svelte/store';
import { DEFAULTS, serializeSettings, settings } from '../../core/settings.svelte';
import { normalizeControl } from '../../core/scenario';
import { actions } from '../../core/registry';
import { announcementLanguages, normalizeSubwayConfig } from './config';
import { normalizeSubwayLines, stepStation } from './lines';
import { runtimeView } from '../../core/runtime.svelte';
import { buildSegmentCuePlan, loadSubwayAssets } from './sound-pack';
import { subwaySceneState } from './runtime';

const role = new URLSearchParams(location.search).get('view') === 'panel' ? 'panel' : 'main';
const browserActionId = 'subway.browser-check';
const stripControlIds = ['prev', 'toggle', 'next', 'spotify', 'browser-strip-5', 'browser-strip-6', 'browser-strip-7', 'browser-strip-8'];
const fixture = structuredClone(DEFAULTS);
const first = { ...structuredClone(fixture.deck.pages[0]), id: 'subway-page-1', name: 'Page 1', items: [] };
const second = { ...structuredClone(fixture.deck.pages[0]), id: 'subway-page-2', name: 'Page 2', items: [] };
fixture.skin = 'subway';
fixture.deck = { ...fixture.deck, pages: [first, second], activePage: first.id };
fixture.skinSettings = { subway: { line: 'yamanote', direction: 'inner' } };
fixture.controls.push(...stripControlIds.slice(4).map((id, index) => normalizeControl({
  id, name: `Browser tile ${index + 5}`, type: 'button',
  variants: [{ label: `Browser tile ${index + 5}`, icon: 'Circle', color: '#79cba3' }],
})));
fixture.skinLayouts = { subway: {
  [first.id]: {
    strip: stripControlIds.map((control, index) => ({ id: `subway-strip-item-${index + 1}`, control, x: index, y: 0, w: 1, h: 1 })),
    side: [{ id: 'subway-side-item', control: 'prev', x: 0, y: 0, w: 1, h: 1 }],
  },
  [second.id]: { strip: [], side: [] },
} };
for (const id of stripControlIds) {
  const stripControl = fixture.controls.find(control => control.id === id);
  if (stripControl) stripControl.scenario = {
    triggers: { ...stripControl.scenario?.triggers, press: { steps: [
      { id: `browser-check-${id}`, kind: 'action', action: { id: browserActionId } },
    ] } },
    events: stripControl.scenario?.events ?? [],
  };
}
localStorage.setItem('supadashboard:settings:v5', serializeSettings(fixture));

mockWindows(role);
mockIPC(() => null, { shouldMockEvents: true });
Object.assign(globalThis, { isTauri: false });
let slotActionCalls = 0;
let assetLoadResult = 'pending';
let cuePlanResult = 'pending';
actions.set(browserActionId, { id: browserActionId, title: 'Browser check slot action', run: () => { slotActionCalls++; return true; } });
void loadSubwayAssets().then(assets => {
  assetLoadResult = 'loaded';
  try {
    const lines = normalizeSubwayLines(assets.lines);
    const config = normalizeSubwayConfig(settings.skinSettings.subway ?? {}, lines);
    const languages = announcementLanguages(config.announcementLanguages);
    for (const line of lines) for (const station of line.stations) for (const direction of line.directions) {
      const next = stepStation(line, station.code, direction.id);
      const bundle = assets.lines[line.id];
      if (next) buildSegmentCuePlan(bundle, station.code, next.code, direction.id, languages, next.transfers.length > 0,
        assets.catalogue, '/subway/', assets.doorSequence);
      buildSegmentCuePlan(bundle, station.code, station.code, direction.id, languages, station.transfers.length > 0,
        assets.catalogue, '/subway/', assets.doorSequence);
    }
    cuePlanResult = 'valid';
  } catch (error) { cuePlanResult = String(error); }
}).catch(error => { assetLoadResult = String(error); cuePlanResult = 'asset load failed'; });

await import('../../main');
Object.assign(window, {
  __subwayDashboardCheck: {
    runtimeOwner: () => get(runtimeView).owner,
    assetLoadResult: () => assetLoadResult,
    cuePlanResult: () => cuePlanResult,
    slotActionCalls: () => slotActionCalls,
    snapshot: () => {
      const snapshot = get(runtimeView);
      return {
        configuredSkin: settings.skin,
        configuredPage: settings.deck.activePage,
        owner: snapshot.owner,
        activePage: snapshot.activePage,
        state: snapshot.variables.records['subway.state']?.value,
        station: snapshot.variables.records['subway.station']?.value,
        line: snapshot.variables.records['subway.line']?.value,
        scene: get(subwaySceneState),
      };
    },
  },
});

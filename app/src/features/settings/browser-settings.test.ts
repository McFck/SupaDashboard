import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './defaults';
import { migrate } from './normalize';

describe('settings v20 to v21', () => {
  it('upgrades the retired page outline in place and carries tabs through the v22 rename', () => {
    const saved = structuredClone(DEFAULTS);
    const placements = [
      { id: 'tabs-tile', control: 'tabs', x: 0, y: 0, w: 2, h: 2 },
      { id: 'outline-tile', control: 'outline', x: 2, y: 0, w: 2, h: 2 },
    ];
    saved.deck.pages[0].items = placements;
    const loaded = migrate({
      ...saved,
      version: 20,
      controls: [
        { id: 'tabs', type: 'browserRemoteTabs', name: 'WebCompanion' },
        { id: 'outline', type: 'webcompanionPageOutline', name: 'Reading touchpad' },
      ],
    });
    expect(loaded.controls).toMatchObject([
      { id: 'tabs', type: 'webcompanionTabs', name: 'WebCompanion' },
      { id: 'outline', type: 'webcompanionTouchpad', name: 'Reading touchpad' },
    ]);
    expect(loaded.deck.pages[0].items).toEqual(placements);
  });
});

describe('settings v21 to v22', () => {
  it('preserves saved tabs controls and placements while renaming their type', () => {
    const saved = structuredClone(DEFAULTS);
    const placements = [
      { id: 'tabs-tile', control: 'tabs', x: 0, y: 0, w: 2, h: 2 },
      { id: 'work-tabs-tile', control: 'work-tabs', x: 2, y: 0, w: 2, h: 3 },
    ];
    saved.deck.pages[0].items = placements;
    saved.variants = { tabs: 0, 'work-tabs': 0 };
    const tabs = {
      id: 'tabs',
      type: 'browserRemoteTabs',
      name: 'Reading tabs',
      options: { background: '#224466', tabOrientation: 'horizontal' },
      variants: [{ id: 'state-1', label: 'Reading', color: '#887766' }],
      scenario: { triggers: {}, events: [] },
    };
    const workTabs = { ...tabs, id: 'work-tabs', name: 'Work tabs' };
    const touchpad = { ...tabs, id: 'touchpad', type: 'webcompanionTouchpad', name: 'Touchpad' };
    const loaded = migrate({ ...saved, version: 21, controls: [tabs, workTabs, touchpad] });
    expect(loaded.version).toBe(22);
    expect(loaded.controls).toEqual([
      { ...tabs, type: 'webcompanionTabs' },
      { ...workTabs, type: 'webcompanionTabs' },
      touchpad,
    ]);
    expect(loaded.deck.pages[0].items).toEqual(placements);
    expect(loaded.variants).toEqual(saved.variants);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './defaults';
import { migrate } from './normalize';

describe('settings v20 to v21', () => {
  it('upgrades the retired page outline in place and leaves browser tabs tiles alone', () => {
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
        { id: 'outline', type: 'webcompanionPageOutline', name: 'Browser remote' },
      ],
    });
    expect(loaded.controls).toMatchObject([
      { id: 'tabs', type: 'browserRemoteTabs', name: 'WebCompanion' },
      { id: 'outline', type: 'webcompanionTouchpad', name: 'Browser remote' },
    ]);
    expect(loaded.deck.pages[0].items).toEqual(placements);
  });
});

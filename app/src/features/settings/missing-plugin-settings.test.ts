import { describe, expect, it } from 'vitest';
import { serializeSettings } from './state.svelte';
import { DEFAULTS } from './defaults';
import { migrate } from './normalize';

describe('settings of a missing plugin', () => {
  it('keeps the tiles and actions of a plugin that is not installed through load and save', () => {
    const tile = {
      id: 'ghost-tile',
      name: 'Ghost',
      type: 'ghost.tile',
      variants: [{ id: 'state-1', label: 'Ghost' }],
      options: { channel: 'ghost-1', future: { keep: true } },
    };
    const button = {
      id: 'ghost-button',
      name: 'Run ghost',
      type: 'button',
      variants: [{ id: 'state-1', label: 'Run' }],
      scenario: {
        triggers: {
          press: {
            steps: [
              { id: 'step-1', kind: 'action', action: { id: 'ghost.run', args: { mode: 'x' } } },
            ],
          },
        },
        events: [],
      },
    };
    const page = DEFAULTS.deck.pages[0];
    const saved = {
      ...structuredClone(DEFAULTS),
      controls: [tile, button],
      deck: {
        pages: [
          {
            ...structuredClone(page),
            items: [
              { id: 'ghost-item', control: 'ghost-tile', x: 0, y: 0, w: 2, h: 2 },
              { id: 'button-item', control: 'ghost-button', x: 2, y: 0, w: 1, h: 1 },
            ],
          },
        ],
        activePage: page.id,
      },
    };
    const loaded = migrate(JSON.parse(JSON.stringify(saved)));
    const written = JSON.parse(serializeSettings(loaded));
    expect(written.controls[0]).toMatchObject({ type: 'ghost.tile', options: tile.options });
    expect(written.controls[1].scenario.triggers).toEqual(button.scenario.triggers);
    expect(written.deck.pages[0].items.map((item: { id: string }) => item.id)).toEqual([
      'ghost-item',
      'button-item',
    ]);
  });
});

// Built-in widgets and skins, registered through the plugin API like any other plugin.
import type { Plugin } from '../core/registry';
import ButtonControl from '../controls/ButtonControl.svelte';
import MixerControl from '../controls/MixerControl.svelte';
import SliderControl from '../controls/SliderControl.svelte';
import DeckSkin from '../skins/deck/DeckSkin.svelte';
import { emptyScenario } from '../core/scenario';

export const uiPlugin: Plugin = {
  id: 'ui',
  title: 'Built-in widgets',
  builtin: true,
  setup(api) {
    api.registerControl({
      type: 'button', title: 'Button', icon: 'SquareMousePointer', component: ButtonControl,
      size: { w: 1, h: 1 }, maxSize: { w: 3, h: 3 },
      create: () => ({ name: 'Button', scenario: { triggers: { press: { steps: [
        { id: 'press-default', kind: 'action', action: { id: 'media.toggle', args: { source: 'system' } } },
      ] } }, events: [] },
        variants: [{ id: 'state-1', label: 'Button', icon: 'Zap', color: '#67c9eb' }] }),
    });
    api.registerControl({
      type: 'slider', title: 'Slider', icon: 'SlidersVertical', component: SliderControl,
      size: { w: 1, h: 3 }, maxSize: { w: 6, h: 6 },
      create: () => ({ name: 'Volume', scenario: emptyScenario(),
        variants: [{ id: 'state-1', label: 'Volume', icon: 'Volume2', color: '#8ea8f0', value: { id: 'volume', args: { target: 'system' } } }] }),
    });
    api.registerControl({
      type: 'mixer', title: 'Volume mixer', icon: 'AudioLines', component: MixerControl,
      size: { w: 4, h: 2 }, minSize: { w: 2, h: 2 }, maxSize: { w: 12, h: 6 },
      create: () => ({ name: 'Mixer', scenario: emptyScenario(), variants: [{ id: 'state-1', label: 'Mixer', color: '#b5a0e8' }], options: { channels: 'auto', max: 6, layout: 'auto' } }),
    });
    api.registerSkin({ id: 'deck', title: 'Deck', component: DeckSkin });
  },
};

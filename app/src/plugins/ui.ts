// Built-in widgets and skins, registered through the plugin API like any other plugin.
import type { Plugin } from '../core/registry';
import ButtonControl from '../controls/ButtonControl.svelte';
import MediaControl from '../controls/MediaControl.svelte';
import MixerControl from '../controls/MixerControl.svelte';
import SliderControl from '../controls/SliderControl.svelte';
import DeckSkin from '../skins/deck/DeckSkin.svelte';
import { emptyScenario } from '../core/scenario';
import { settings } from '../core/settings.svelte';
import { currentRuntime } from '../core/runtime.svelte';

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
    api.registerControl({
      type: 'media', title: 'Media', icon: 'Image', component: MediaControl,
      size: { w: 2, h: 2 }, minSize: { w: 1, h: 1 },
      create: () => ({ name: 'Media', scenario: emptyScenario(), variants: [{ id: 'state-1', label: '' }],
        options: { sources: [], fit: 'cover', interval: 5, loop: true, muted: true } }),
    });
    const mediaTargets = () => [
      { value: 'self', label: 'This widget' },
      ...settings.controls.filter(control => control.type === 'media' &&
        settings.deck.pages.some(page => page.items.some(item => item.control === control.id)))
        .map(control => ({ value: control.id, label: control.name })),
    ];
    for (const [id, title, command] of [['media.nextSlide', 'Next slide', 'next'], ['media.prevSlide', 'Previous slide', 'prev']] as const)
      api.registerAction({ id, title, params: [{ key: 'target', label: 'Target', type: 'select', default: 'self', suggestions: mediaTargets }],
        run: (args, context) => {
          if (!context || context.signal.aborted) return;
          return currentRuntime()?.contentCommand(typeof args.target === 'string' && args.target !== 'self' ? args.target : context.controlId, command);
        },
      });
    api.registerSkin({ id: 'deck', title: 'Deck', component: DeckSkin });
  },
};

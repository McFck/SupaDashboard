// Built-in widgets and skins, registered through the plugin API like any other plugin.
import type { Plugin } from '../features/plugins/contracts';
import ButtonControl from '../controls/ButtonControl.svelte';
import ButtonFace from '../controls/ButtonFace.svelte';
import MediaControl from '../controls/MediaControl.svelte';
import MixerControl from '../controls/MixerControl.svelte';
import SliderControl from '../controls/SliderControl.svelte';
import SliderFace from '../controls/SliderFace.svelte';
import WebControl from '../controls/WebControl.svelte';
import DeckSkin from '../skins/deck/DeckSkin.svelte';
import { emptyScenario } from '../core/scenario';
import { settings } from '../core/settings.svelte';
import { currentRuntime } from '../core/runtime.svelte';
import { hasPlacement } from '../core/skin-layouts';

export const uiPlugin: Plugin = {
  id: 'ui',
  title: 'Built-in widgets',
  builtin: true,
  setup(api) {
    api.registerControl({
      type: 'button', title: 'Button', icon: 'SquareMousePointer', component: ButtonControl, face: ButtonFace,
      size: { w: 1, h: 1 }, maxSize: { w: 3, h: 3 },
      create: () => ({ name: 'Button', scenario: { triggers: { press: { steps: [
        { id: 'press-default', kind: 'action', action: { id: 'media.toggle', args: { source: 'system' } } },
      ] } }, events: [] },
        variants: [{ id: 'state-1', label: 'Button', icon: 'Zap', color: '#67c9eb' }] }),
    });
    api.registerControl({
      type: 'slider', title: 'Slider', icon: 'SlidersVertical', component: SliderControl, face: SliderFace,
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
        options: { sources: [], interval: 0, loop: true, muted: true } }),
    });
    api.registerControl({
      type: 'web', title: 'Web', icon: 'Globe', component: WebControl,
      size: { w: 3, h: 2 }, minSize: { w: 2, h: 2 },
      create: () => ({ name: 'Web', scenario: emptyScenario(), variants: [{ id: 'state-1', label: '' }],
        options: { url: '', zoom: 100, refresh: 0, interactive: false } }),
    });
    const mediaTargets = () => [
      { value: 'self', label: 'This widget' },
      ...settings.controls.filter(control => control.type === 'media' && hasPlacement(settings, control.id))
        .map(control => ({ value: control.id, label: control.name })),
    ];
    for (const [id, title, command] of [['media.nextSlide', 'Next slide', 'next'], ['media.prevSlide', 'Previous slide', 'prev']] as const)
      api.registerAction({ id, title, params: [{ key: 'target', label: 'Target', type: 'select', default: 'self', suggestions: mediaTargets }],
        run: (args, context) => {
          if (!context || context.signal.aborted) return;
          return currentRuntime()?.contentCommand(typeof args.target === 'string' && args.target !== 'self' ? args.target : context.controlId, command);
        },
      });
    const webTargets = () => [
      { value: 'self', label: 'This widget' },
      ...settings.controls.filter(control => control.type === 'web' && hasPlacement(settings, control.id))
        .map(control => ({ value: control.id, label: control.name })),
    ];
    api.registerAction({ id: 'web.reload', title: 'Reload web page',
      params: [{ key: 'target', label: 'Target', type: 'select', default: 'self', suggestions: webTargets }],
      run: (args, context) => {
        if (!context || context.signal.aborted) return;
        return currentRuntime()?.contentCommand(typeof args.target === 'string' && args.target !== 'self' ? args.target : context.controlId, 'reload');
      },
    });
    api.registerSkin({ id: 'deck', title: 'Deck', component: DeckSkin,
      slots: [{ id: 'main', style: 'region', kind: 'grid', grid: 'page' }],
      views: [{ id: 'default', title: 'Deck', slots: ['main'] }], defaultView: 'default' });
  },
};

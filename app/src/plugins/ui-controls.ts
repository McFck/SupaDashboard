import { DEFAULT_MIXER_MAX_CHANNELS } from '../features/controls/model';
import ButtonControl from '../features/controls/ui/ButtonControl.svelte';
import ButtonFace from '../features/controls/ui/ButtonFace.svelte';
import MediaControl from '../features/controls/ui/MediaControl.svelte';
import NowPlayingControl from '../features/controls/ui/NowPlayingControl.svelte';
import MixerControl from '../features/controls/ui/MixerControl.svelte';
import SliderControl from '../features/controls/ui/SliderControl.svelte';
import SliderFace from '../features/controls/ui/SliderFace.svelte';
import WebControl from '../features/controls/ui/WebControl.svelte';
import { emptyScenario } from '../features/automation/scenario';
import type { PluginApi } from '../features/plugins/contracts';

export function registerUiControls(api: PluginApi) {
  api.registerControl({
    type: 'button',
    title: 'Button',
    icon: 'SquareMousePointer',
    component: ButtonControl,
    face: ButtonFace,
    size: { w: 1, h: 1 },
    maxSize: { w: 3, h: 3 },
    create: () => ({
      name: 'Button',
      scenario: {
        triggers: {
          press: {
            steps: [
              {
                id: 'press-default',
                kind: 'action',
                action: { id: 'media.toggle', args: { source: 'system' } },
              },
            ],
          },
        },
        events: [],
      },
      variants: [{ id: 'state-1', label: 'Button', icon: 'Zap', color: '#67c9eb' }],
    }),
  });
  api.registerControl({
    type: 'slider',
    title: 'Slider',
    icon: 'SlidersVertical',
    component: SliderControl,
    face: SliderFace,
    size: { w: 1, h: 3 },
    maxSize: { w: 6, h: 6 },
    create: () => ({
      name: 'Volume',
      scenario: emptyScenario(),
      variants: [
        {
          id: 'state-1',
          label: 'Volume',
          icon: 'Volume2',
          color: '#8ea8f0',
          value: { id: 'volume', args: { target: 'system' } },
        },
      ],
    }),
  });
  api.registerControl({
    type: 'mixer',
    title: 'Volume mixer',
    icon: 'AudioLines',
    component: MixerControl,
    size: { w: 4, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 12, h: 6 },
    create: () => ({
      name: 'Mixer',
      scenario: emptyScenario(),
      variants: [{ id: 'state-1', label: 'Mixer', color: '#b5a0e8' }],
      options: { channels: 'auto', max: DEFAULT_MIXER_MAX_CHANNELS, layout: 'auto' },
    }),
  });
  api.registerControl({
    type: 'media',
    title: 'Media',
    icon: 'Image',
    component: MediaControl,
    size: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    create: () => ({
      name: 'Media',
      scenario: emptyScenario(),
      variants: [{ id: 'state-1', label: '' }],
      options: { sources: [], interval: 0, loop: true, muted: true },
    }),
  });
  api.registerControl({
    type: 'nowPlaying',
    title: 'Now playing',
    icon: 'Disc3',
    component: NowPlayingControl,
    size: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    create: () => ({
      name: 'Now playing',
      scenario: {
        triggers: {
          swipeLeft: {
            steps: [
              {
                id: 'swipe-left-default',
                kind: 'action',
                action: { id: 'media.next', args: { target: 'self' } },
              },
            ],
          },
          swipeRight: {
            steps: [
              {
                id: 'swipe-right-default',
                kind: 'action',
                action: { id: 'media.prev', args: { target: 'self' } },
              },
            ],
          },
        },
        events: [],
      },
      variants: [{ id: 'state-1', label: '' }],
      options: { sources: [] },
    }),
  });
  api.registerControl({
    type: 'web',
    title: 'Web',
    icon: 'Globe',
    component: WebControl,
    size: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    create: () => ({
      name: 'Web',
      scenario: emptyScenario(),
      variants: [{ id: 'state-1', label: '' }],
      options: { url: '', zoom: 100, refresh: 0, interactive: false },
    }),
  });
}

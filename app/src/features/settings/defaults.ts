import { DEFAULT_MIXER_MAX_CHANNELS, type ControlConfig } from '../controls/model';
import { normalizeControl } from '../automation/normalize-control';
import type { Page, Settings } from './schema';

const swapVertical = {
  swipeDown: { variant: 'next' as const },
  swipeUp: { variant: 'prev' as const },
};
const media = (id: string, icon: string, name: string, color: string): ControlConfig =>
  normalizeControl({
    id,
    name,
    type: 'button',
    gestures: swapVertical,
    variants: [
      { label: name, icon, color, action: { id: `media.${id}`, args: { source: 'system' } } },
      {
        label: name,
        icon,
        color: '#66ce8f',
        action: { id: `media.${id}`, args: { source: 'spotify' } },
      },
    ],
  });

export const DEFAULT_PAGE: Page = {
  id: 'page-1',
  name: 'Page 1',
  rows: 3,
  cols: 6,
  size: 112,
  sizing: 'auto',
  gap: 14,
  items: [
    { id: 'i1', control: 'prev', x: 0, y: 0, w: 1, h: 1 },
    { id: 'i2', control: 'toggle', x: 1, y: 0, w: 1, h: 1 },
    { id: 'i3', control: 'next', x: 2, y: 0, w: 1, h: 1 },
    { id: 'i4', control: 'spotify', x: 3, y: 0, w: 1, h: 1 },
    { id: 'i5', control: 'mixer', x: 0, y: 1, w: 4, h: 2 },
    { id: 'i6', control: 'volume', x: 4, y: 0, w: 1, h: 3 },
  ],
};

export const DEFAULTS: Settings = {
  version: 12,
  display: {
    monitor: null,
    monitorLabel: null,
    fullscreen: false,
    alwaysOnTop: false,
    iconScale: 1,
    labelScale: 1,
    background: { mode: 'color', color: '#0a0a0a', opacity: 0.55, radius: 28 },
  },
  controls: [
    media('prev', 'SkipBack', 'Previous', '#67c9eb'),
    media('toggle', 'Play', 'Play / pause', '#e9c878'),
    media('next', 'SkipForward', 'Next', '#67c9eb'),
    normalizeControl({
      id: 'volume',
      name: 'Volume',
      type: 'slider',
      gestures: { swipeLeft: { variant: 'next' }, swipeRight: { variant: 'prev' } },
      variants: [
        {
          label: 'Volume',
          icon: 'Volume2',
          color: '#8ea8f0',
          value: { id: 'volume', args: { target: 'system' } },
        },
        {
          label: 'Spotify',
          icon: 'spotify',
          color: '#66ce8f',
          value: { id: 'volume', args: { target: 'spotify' } },
        },
      ],
    }),
    normalizeControl({
      id: 'mixer',
      name: 'Mixer',
      type: 'mixer',
      variants: [{ label: 'Mixer', color: '#b5a0e8' }],
      options: { channels: 'auto', max: DEFAULT_MIXER_MAX_CHANNELS, layout: 'auto' },
    }),
    normalizeControl({
      id: 'spotify',
      name: 'Spotify',
      type: 'button',
      variants: [
        { label: 'Spotify', icon: 'spotify', color: '#66ce8f', action: { id: 'spotify.open' } },
      ],
    }),
  ],
  deck: { pages: [structuredClone(DEFAULT_PAGE)], activePage: DEFAULT_PAGE.id },
  appletSettings: {},
  appletLayouts: {},
  variants: {},
  apps: [],
};

export const ICON_SCALE = { min: 1, max: 2, step: 0.1 } as const;
export const LABEL_SCALE = ICON_SCALE;

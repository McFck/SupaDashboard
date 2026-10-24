import type { Plugin } from '../../core/registry';
import SubwaySkin from './SubwaySkin.svelte';
import { runtime } from './runtime';

export const subwayPlugin: Plugin = {
  id: 'subway',
  title: 'Subway skin',
  description: 'Japanese train passenger-information display with a compact control bar.',
  icon: 'TrainFront',
  author: 'SupaDashboard',
  version: '1.0.0',
  updated: '2026-10-23',
  source: 'bundled',
  size: 1618,
  setup(api) {
    api.registerSkin({ id: 'subway', title: 'Subway', component: SubwaySkin, runtime,
      design: { width: 1920, height: 600 },
      slots: [
        { id: 'strip', style: 'region', kind: 'strip', rect: { x: 0, y: 480, w: 1920, h: 120 },
          accepts: ['button', 'slider'], max: 8, size: { w: 1, h: 1 },
          grid: { rows: 1, cols: 8, size: 112, gap: 8, sizing: 'auto' } },
        { id: 'side', style: 'anchored', kind: 'grid', rect: { x: 1728, y: 64, w: 128, h: 352 },
          accepts: ['button'], max: 2, size: { w: 1, h: 1 },
          grid: { rows: 2, cols: 1, size: 112, gap: 8, sizing: 'auto' } },
      ],
      views: [
        { id: 'display', title: 'Display', slots: ['strip'] },
        { id: 'cab', title: 'Cab', slots: ['strip', 'side'] },
      ], defaultView: 'display' });
  },
};

import type { Plugin } from '../../core/registry';
import SubwaySkin from './SubwaySkin.svelte';

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
    api.registerSkin({ id: 'subway', title: 'Subway', component: SubwaySkin });
  },
};

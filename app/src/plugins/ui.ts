import type { Plugin } from '../features/plugins/contracts';
import DeckSkin from '../features/skins/deck/DeckSkin.svelte';
import { registerUiControls } from './ui-controls';
import { registerUiContentActions } from './ui-content-actions';

export const uiPlugin: Plugin = {
  id: 'ui',
  title: 'Built-in widgets',
  builtin: true,
  setup(api) {
    registerUiControls(api);
    registerUiContentActions(api);
    api.registerSkin({
      id: 'deck',
      title: 'Deck',
      component: DeckSkin,
      slots: [{ id: 'main', style: 'region', kind: 'grid', grid: 'page' }],
      views: [{ id: 'default', title: 'Deck', slots: ['main'] }],
      defaultView: 'default',
    });
  },
};

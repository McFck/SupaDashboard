import type { Plugin } from '../features/plugins/contracts';
import DeckApplet from '../features/applets/deck/DeckApplet.svelte';
import { registerUiControls } from './ui-controls';
import { registerUiContentActions } from './ui-content-actions';

export const uiPlugin: Plugin = {
  id: 'ui',
  title: 'Built-in widgets',
  builtin: true,
  setup(api) {
    registerUiControls(api);
    registerUiContentActions(api);
    api.registerApplet({
      id: 'deck',
      title: 'Deck',
      component: DeckApplet,
      slots: [{ id: 'main', style: 'region', kind: 'grid', grid: 'page' }],
      views: [{ id: 'default', title: 'Deck', slots: ['main'] }],
      defaultView: 'default',
    });
  },
};

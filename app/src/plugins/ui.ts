import type { Plugin } from '../features/plugins/contracts';
import { registerUiControls } from './ui-controls';
import { registerUiContentActions } from './ui-content-actions';

export const uiPlugin: Plugin = {
  id: 'ui',
  title: 'Built-in widgets',
  builtin: true,
  setup(api) {
    registerUiControls(api);
    registerUiContentActions(api);
  },
};

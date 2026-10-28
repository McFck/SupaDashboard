import type { Plugin } from '../features/plugins/contracts';
import { registerCoreMedia } from './core-media';
import { registerCoreControls } from './core-controls';
import { registerCoreAutomation } from './core-automation';
import { registerCoreVolume } from './core-volume';
import { registerCoreUtilities } from './core-utilities';

export const corePlugin: Plugin = {
  id: 'core',
  title: 'Core',
  builtin: true,
  setup(api) {
    registerCoreMedia(api);
    registerCoreControls(api);
    registerCoreAutomation(api);
    registerCoreVolume(api);
    registerCoreUtilities(api);
  },
};

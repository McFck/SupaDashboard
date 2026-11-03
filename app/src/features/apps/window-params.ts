import { isTauri } from '@tauri-apps/api/core';
import type { Param } from '../plugins/contracts';
import { isAppKey } from './keys';
import { listAppWindows } from '../../platform/apps';

export const windowsParam: Param = {
  key: 'windows',
  label: 'Windows',
  type: 'select',
  default: 'all',
  suggestions: [
    { value: 'main', label: 'Main window' },
    { value: 'all', label: 'All windows' },
    { value: 'window', label: 'Specific window' },
    { value: 'title', label: 'Window title contains' },
  ],
};
let openWindows: string[] = [];
export const windowParam: Param = {
  key: 'window',
  label: 'Window',
  type: 'select',
  searchable: true,
  default: '',
  suggestions: () => openWindows.map((title) => ({ value: title, label: title })),
  refresh: async (args) => {
    const app = args?.app;
    openWindows = isTauri() && isAppKey(app) ? await listAppWindows(app) : [];
  },
  visible: (args) => args.windows === 'window',
};
export const titleParam: Param = {
  key: 'title',
  label: 'Window title contains',
  type: 'text',
  default: '',
  visible: (args) => args.windows === 'title',
};

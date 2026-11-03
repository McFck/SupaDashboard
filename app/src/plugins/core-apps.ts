import { invoke, isTauri } from '@tauri-apps/api/core';
import { primaryMonitor } from '@tauri-apps/api/window';
import { buildMonitorOptions, type MonitorOption } from '../features/display/monitor-options';
import { APP_ACTIONS, appRequest } from '../features/apps/keys';
import { windowsParam, windowParam, titleParam } from '../features/apps/window-params';
import { appParam } from '../features/apps/picker.svelte';
import { ActionFailure } from '../features/automation/action-failure';
import type { Param, Plugin } from '../features/plugins/contracts';
import { runAppCommand } from '../platform/apps';
import { monitors } from '../platform/window';

const TITLES = {
  open: 'Open app',
  focus: 'Focus app',
  toggle: 'Toggle app',
  minimize: 'Minimize app',
  close: 'Close app',
  quit: 'Quit app',
} as const;

let screens: MonitorOption[] = [];

const displayParam: Param = {
  key: 'display',
  label: 'Display',
  type: 'select',
  default: '',
  suggestions: () => [
    { value: '', label: 'Current position' },
    ...screens.map((screen) => ({
      value: screen.value,
      label: screen.label,
      detail: screen.detail,
    })),
  ],
  refresh: async () => {
    if (isTauri()) {
      const [list, names, primary] = await Promise.all([
        monitors(),
        invoke<unknown[]>('monitor_names'),
        primaryMonitor(),
      ]);
      screens = buildMonitorOptions(list, names, primary);
    }
  },
};

const hideParam: Param = {
  key: 'hide',
  label: 'Hide by',
  type: 'select',
  default: 'minimize',
  suggestions: [
    { value: 'minimize', label: 'Minimize' },
    { value: 'close', label: 'Close' },
  ],
};

const forceParam = (label: string): Param => ({
  key: 'force',
  label,
  type: 'boolean',
  default: false,
});

const PARAMS: Record<(typeof APP_ACTIONS)[number], Param[]> = {
  open: [appParam],
  focus: [appParam, windowsParam, windowParam, titleParam, displayParam],
  toggle: [
    appParam,
    windowsParam,
    windowParam,
    titleParam,
    displayParam,
    hideParam,
    forceParam('Force close'),
  ],
  minimize: [appParam, windowsParam, windowParam, titleParam],
  close: [appParam, forceParam('Force')],
  quit: [appParam],
};

export const appsPlugin: Plugin = {
  id: 'core-apps',
  title: 'Apps',
  builtin: true,
  setup(api) {
    for (const op of APP_ACTIONS) {
      api.registerAction({
        id: `app.${op}`,
        title: TITLES[op],
        params: PARAMS[op],
        run: async (args) => {
          try {
            await runAppCommand(appRequest(op, args));
          } catch (error) {
            // The native side answers with a short title such as "Couldn't close Discord".
            throw new ActionFailure(
              typeof error === 'string'
                ? error
                : error instanceof Error
                  ? error.message
                  : 'App action failed',
            );
          }
        },
      });
    }
  },
};

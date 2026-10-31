import { invoke, isTauri } from '@tauri-apps/api/core';
import { primaryMonitor } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { buildMonitorOptions, type MonitorOption } from '../features/display/monitor-options';
import { APP_ACTIONS, appLabel, appRequest, isAppKey, usedApps } from '../features/apps/keys';
import { commit } from '../features/layout/history.svelte';
import { settings } from '../features/settings/state.svelte';
import type { Option, Param, Plugin } from '../features/plugins/contracts';
import { listApps, runAppCommand, type AppRow } from '../platform/apps';
import { monitors } from '../platform/window';

const TITLES = {
  open: 'Open app',
  focus: 'Focus app',
  toggle: 'Toggle app',
  minimize: 'Minimize app',
  close: 'Close app',
} as const;

let rows: AppRow[] = [];
let screens: MonitorOption[] = [];

/** Running apps, then the Start menu, then apps used by actions or added by hand. */
function appOptions(): Option[] {
  const options: Option[] = rows.map((row) => ({
    value: row.key,
    label: row.label,
    detail: row.key.startsWith('exe:') ? row.detail : undefined,
  }));
  const known = new Set(rows.map((row) => row.key));
  for (const key of [...settings.apps, ...usedApps(settings.controls)]) {
    if (!known.has(key)) {
      known.add(key);
      options.push({ value: key, label: appLabel(key) });
    }
  }
  return options;
}

function remember(key: string) {
  if (!settings.apps.includes(key)) {
    settings.apps.push(key);
    commit('Add app');
  }
}

const appParam: Param = {
  key: 'app',
  label: 'App',
  type: 'text',
  default: '',
  suggestions: appOptions,
  refresh: async () => {
    if (isTauri()) {
      rows = await listApps();
    }
  },
  manual: {
    browse: async () => {
      const path = await open({ filters: [{ name: 'App', extensions: ['exe'] }] });
      if (typeof path !== 'string') {
        return null;
      }
      remember(`exe:${path}`);
      return `exe:${path}`;
    },
    keep: (value) => {
      if (isAppKey(value) && !rows.some((row) => row.key === value)) {
        remember(value);
      }
    },
  },
};

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
  focus: [appParam, displayParam],
  toggle: [appParam, displayParam, hideParam, forceParam('Force close')],
  minimize: [appParam],
  close: [appParam, forceParam('Force')],
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
        run: (args) => runAppCommand(appRequest(op, args)),
      });
    }
  },
};

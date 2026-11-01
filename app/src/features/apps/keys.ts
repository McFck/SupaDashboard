// App keys and the arguments of app actions. The native side validates again; this fails early with a short title.
import { walkSteps } from '../automation/scenario';
import type { ControlConfig } from '../controls/model';

const MAX_KEY = 1024;
export const APP_ACTIONS = ['open', 'focus', 'toggle', 'minimize', 'close'] as const;
export type AppOp = (typeof APP_ACTIONS)[number];

export const APP_STATES = [
  { value: 'running', label: 'Running' },
  { value: 'focused', label: 'In front' },
  { value: 'minimized', label: 'Minimized' },
  { value: 'visible', label: 'Visible' },
  { value: 'display', label: 'Display' },
] as const;
export type AppField = (typeof APP_STATES)[number]['value'];

export type AppRequest = {
  op: AppOp;
  app: string;
  display?: string;
  hide?: 'minimize' | 'close';
  force?: boolean;
  windows?: 'main' | 'all' | 'title';
  title?: string;
};

/** `aumid:<Start menu id>` or `exe:<absolute path>`. */
export function isAppKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_KEY &&
    /^(aumid|exe):\S/.test(value) &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

/** `app.<slug>.<state>`, the variable the watcher publishes for an app, taken apart. */
export function parseAppVariable(id: string): { slug: string; field: AppField } | undefined {
  const match = /^app\.([a-z0-9_-]+)\.([a-z]+)$/.exec(id);
  const field = APP_STATES.find((state) => state.value === match?.[2]);
  return match && field ? { slug: match[1], field: field.value } : undefined;
}

/** The id of a binding that picked an app state but no app yet. */
export const pendingAppVariable = (field: AppField) => `app..${field}`;

/** The app state a variable id names, with or without an app chosen yet. */
export const appFieldOf = (id: string): AppField | undefined =>
  parseAppVariable(id)?.field ??
  APP_STATES.find((state) => id === pendingAppVariable(state.value))?.value;

/** The label for a key the picker has no row for: the file name, or the Start menu id. */
export function appLabel(key: string) {
  const name = key.slice(key.indexOf(':') + 1);
  return key.startsWith('exe:') ? (name.split(/[\\/]/).pop() ?? name).replace(/\.exe$/i, '') : name;
}

export function appRequest(op: AppOp, args: Record<string, unknown>): AppRequest {
  if (!isAppKey(args.app)) {
    throw new Error('Choose an app');
  }
  const request: AppRequest = { op, app: args.app };
  if (op === 'focus' || op === 'toggle' || op === 'minimize') {
    const windows = args.windows === undefined ? 'all' : args.windows;
    if (windows !== 'main' && windows !== 'all' && windows !== 'title') {
      throw new Error('Choose windows');
    }
    const title = args.title === undefined ? '' : args.title;
    if (
      typeof title !== 'string' ||
      new TextEncoder().encode(title).length > MAX_KEY ||
      /[\u0000-\u001f\u007f-\u009f]/.test(title)
    ) {
      throw new Error('The window title is not valid');
    }
    if (windows === 'title' && !title.trim()) {
      throw new Error('Enter a window title');
    }
    if (op === 'toggle' && args.hide === 'close' && args.force === true && windows !== 'all') {
      throw new Error('Force close requires All windows');
    }
    request.windows = windows;
    request.title = title.trim();
  }
  if (typeof args.display === 'string' && args.display) {
    request.display = args.display;
  }
  if (args.hide === 'close') {
    request.hide = 'close';
  }
  if (args.force === true) {
    request.force = true;
  }
  return request;
}

/** Apps named by the app actions of every control, in order of first use. */
export function usedApps(controls: readonly ControlConfig[]): string[] {
  const used = new Set<string>();
  for (const control of controls) {
    if (control.scenario) {
      walkSteps(control.scenario, (step) => {
        if (step.kind === 'action' && step.action.id.startsWith('app.')) {
          const app = step.action.args?.app;
          if (isAppKey(app)) {
            used.add(app);
          }
        }
      });
    }
  }
  return [...used];
}

/** Everything to watch: apps used by actions, plus the ones added by hand. */
export const watchedKeys = (controls: readonly ControlConfig[], manual: readonly string[]) => [
  ...new Set([...usedApps(controls), ...manual.filter(isAppKey)]),
];

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

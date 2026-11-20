// A plugin's native permissions (`plugin_host/permissions.rs` validates them strictly) as the Market, plugin pages
// and the install confirmation show them.
import { isRecord } from '../automation/plain-data';

type Login = { authorize?: string; token?: string; url?: string };

export type PluginPermissions = {
  http: string[];
  pipes: string[];
  process: string[];
  automation: string[];
  browser: string | null;
  displays: boolean;
  open: string[];
  /** OAuth clients and web sign-ins by secret name. */
  logins: Login[];
};

export type PermissionRow = { label: string; value: string };

const LISTS = ['http', 'pipes', 'process', 'automation', 'open'] as const;

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
const isLogin = (value: unknown): value is Login =>
  isRecord(value) && [value.authorize, value.token, value.url].every(optionalString);

/** The `permissions` of `plugin_list`, a catalogue entry or an inspected file; null when malformed. */
export function pluginPermissions(raw: unknown): PluginPermissions | null {
  if (!isRecord(raw)) {
    return null;
  }
  const lists = LISTS.map((key) => raw[key] ?? []);
  const maps = [raw.oauth ?? {}, raw.signin ?? {}];
  const browser = raw.browser ?? null;
  const displays = raw.displays === undefined ? false : raw.displays;
  if (typeof displays !== 'boolean') {
    return null;
  }
  if (browser !== null && (typeof browser !== 'string' || !/^[a-p]{32}$/.test(browser))) {
    return null;
  }
  if (!lists.every(strings) || !maps.every(isRecord)) {
    return null;
  }
  const logins = maps.flatMap((map) => Object.values(map));
  if (!logins.every(isLogin)) {
    return null;
  }
  const [http, pipes, process, automation, open] = lists;
  return { http, pipes, process, automation, browser, displays, open, logins };
}

function host(url: string | undefined) {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    // Native accepts only https URLs here; an unparsable one just shows no host.
    return '';
  }
}

/** One row per kind of reach; nothing for a plugin that reaches nothing natively. */
export function permissionRows(permissions: PluginPermissions): PermissionRow[] {
  const signIn = permissions.logins.map((login) =>
    host(login.authorize ?? login.url ?? login.token),
  );
  const rows: [string, string[]][] = [
    ['Internet', permissions.http],
    ['Sign-in', [...new Set(signIn.filter(Boolean))]],
    ['Local app', permissions.pipes],
    ['Runs', permissions.process],
    ['Controls', permissions.automation],
    ['Browser control', permissions.browser ? ['Paired browser extension'] : []],
    ['Displays', permissions.displays ? ['Names and geometry'] : []],
    ['Opens', permissions.open.map((scheme) => `${scheme}: links`)],
  ];
  return rows
    .filter(([, values]) => values.length)
    .map(([label, values]) => ({ label, value: values.join(', ') }));
}

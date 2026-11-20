// A plugin's native permissions (`plugin_host/permissions.rs` validates them strictly) as the Market, plugin pages
// and the install confirmation show them.
import { isRecord } from '../automation/plain-data';

type Login = {
  name: string;
  authorize?: string;
  token?: string;
  redirect?: string;
  url?: string;
  storage?: string;
  profile?: string;
  scopes?: string[];
  send?: string[];
};

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
const isLogin = (value: unknown): value is Omit<Login, 'name'> =>
  isRecord(value) &&
  [value.authorize, value.token, value.redirect, value.url, value.storage, value.profile].every(
    optionalString,
  ) &&
  [value.scopes, value.send].every((list) => list === undefined || strings(list));

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
  const logins: Login[] = [];
  for (const [name, login] of maps.flatMap((map) => Object.entries(map))) {
    if (!isLogin(login)) {
      return null;
    }
    logins.push({ ...login, name });
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
export function permissionRows(permissions: PluginPermissions, expanded = false): PermissionRow[] {
  const signIn = permissions.logins.map((login) =>
    host(login.authorize ?? login.url ?? login.token),
  );
  const rows: [string, string[]][] = [
    ['Internet', permissions.http],
    ['Sign-in', expanded ? [] : [...new Set(signIn.filter(Boolean))]],
    ['Local app', permissions.pipes],
    ['Runs', permissions.process],
    ['Controls', permissions.automation],
    [
      'Browser control',
      permissions.browser ? [expanded ? permissions.browser : 'Paired browser extension'] : [],
    ],
    ['Displays', permissions.displays ? ['Names and geometry'] : []],
    ['Opens', permissions.open.map((scheme) => `${scheme}: links`)],
  ];
  const summary = rows
    .filter(([, values]) => values.length)
    .map(([label, values]) => ({ label, value: values.join(', ') }));
  if (!expanded) {
    return summary;
  }
  const logins = permissions.logins.flatMap((login): PermissionRow[] => {
    const fields: [string, string | undefined][] = [
      ['Sign-in', login.authorize ?? login.url],
      ['Token endpoint', login.token],
      ['Redirect', login.redirect],
      ['Storage key', login.storage],
      ['Profile', login.profile],
      ['Scopes', login.scopes?.join(', ')],
      ['Token recipients', login.send?.join(', ')],
    ];
    return [
      { label: 'Account', value: login.name },
      ...fields.flatMap(([label, value]) => (value ? [{ label, value }] : [])),
    ];
  });
  return [...summary, ...logins];
}

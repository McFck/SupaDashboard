import { pluginPermissions, type PluginPermissions } from './permissions';

export type PluginState = {
  uninstalled: string[];
  installed: Record<string, string>;
};
export function normalizePluginState(value: unknown): PluginState {
  const raw = value && typeof value === 'object' ? (value as Partial<PluginState>) : {};
  return {
    uninstalled: Array.isArray(raw.uninstalled)
      ? [...new Set(raw.uninstalled.filter((id) => typeof id === 'string'))]
      : [],
    installed: Object.fromEntries(
      Object.entries(
        raw.installed && typeof raw.installed === 'object' ? raw.installed : {},
      ).filter(([, date]) => typeof date === 'string' && Number.isFinite(Date.parse(date))),
    ),
  };
}

/** A plugin id, as native accepts it. */
export const PLUGIN_ID = /^[a-z0-9-]{1,64}$/;

/** A plugin in the signed catalogue. `published` is an ISO date, `size` bytes, `source` an https page. */
export type CatalogEntry = {
  id: string;
  title: string;
  description: string;
  icon: string;
  version: string;
  api: number;
  published: string;
  size: number;
  source: string;
  guide: string;
  permissions: PluginPermissions;
};
const TEXT = [
  'id',
  'title',
  'description',
  'icon',
  'version',
  'published',
  'source',
  'guide',
] as const;
const https = (value: string) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};
/** `plugin_catalogue` entries; native checked the signature, this checks what the Market renders and links. */
export function catalogEntries(value: unknown): CatalogEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is Omit<CatalogEntry, 'permissions'> & { permissions: unknown } =>
        !!entry &&
        typeof entry === 'object' &&
        TEXT.every((key) => typeof entry[key] === 'string') &&
        PLUGIN_ID.test(entry.id) &&
        entry.title.length > 0 &&
        Number.isSafeInteger(entry.api) &&
        Number.isSafeInteger(entry.size) &&
        entry.size >= 0 &&
        https(entry.source),
    )
    .flatMap((entry) => {
      const permissions = pluginPermissions(entry.permissions);
      return permissions ? [{ ...entry, permissions }] : [];
    });
}

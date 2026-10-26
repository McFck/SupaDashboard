export type PluginState = { uninstalled: string[]; installed: Record<string, string>; catalogUrl: string };
export function normalizePluginState(value: unknown): PluginState {
  const raw = value && typeof value === 'object' ? value as Partial<PluginState> : {};
  return {
    uninstalled: Array.isArray(raw.uninstalled) ? [...new Set(raw.uninstalled.filter(id => typeof id === 'string'))] : [],
    installed: Object.fromEntries(Object.entries(raw.installed && typeof raw.installed === 'object' ? raw.installed : {})
      .filter(([, date]) => typeof date === 'string' && Number.isFinite(Date.parse(date)))),
    catalogUrl: typeof raw.catalogUrl === 'string' ? raw.catalogUrl : '',
  };
}

export type CatalogEntry = { id: string; title: string; author: string; icon?: string; description?: string };
export function catalogEntries(value: unknown): CatalogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is CatalogEntry => !!entry && typeof entry === 'object'
    && typeof entry.id === 'string' && entry.id.length > 0 && typeof entry.title === 'string'
    && typeof entry.author === 'string' && (entry.icon === undefined || typeof entry.icon === 'string')
    && (entry.description === undefined || typeof entry.description === 'string'));
}

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

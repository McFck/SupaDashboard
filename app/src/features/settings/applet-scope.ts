import type { AppletSettingsEntry } from './schema';

type Values = Record<string, unknown>;

/** The values `pageId` renders with: its own when settings are separate and it has some, otherwise the shared ones. */
export function appletValues(entry: AppletSettingsEntry | undefined, pageId: string): Values {
  if (!entry) {
    return {};
  }
  return (entry.separate ? entry.perPage?.[pageId] : undefined) ?? entry.shared;
}

/** Stores `values` where `appletValues(entry, pageId)` reads them from. */
export function withAppletValues(
  entry: AppletSettingsEntry | undefined,
  pageId: string,
  values: Values,
): AppletSettingsEntry {
  const current = entry ?? { shared: {}, separate: false };
  if (!current.separate) {
    return { ...current, shared: values };
  }
  return { ...current, perPage: { ...current.perPage, [pageId]: values } };
}

/**
 * Turning separation on gives every page without values of its own a copy of the shared ones. Turning it off keeps
 * `perPage` so switching back restores it.
 */
export function withSeparateAppletSettings(
  entry: AppletSettingsEntry | undefined,
  pageIds: readonly string[],
  separate: boolean,
): AppletSettingsEntry {
  const current = entry ?? { shared: {}, separate: false };
  if (!separate) {
    return { ...current, separate: false };
  }
  const perPage = { ...current.perPage };
  for (const id of pageIds) {
    perPage[id] ??= structuredClone(current.shared);
  }
  return { ...current, separate: true, perPage };
}

/** What each applet's runtime reads: the values of the page being shown, since the owner runs one instance. */
export function runtimeAppletValues(
  source: { appletSettings: Record<string, AppletSettingsEntry> },
  activePageId: string,
): Record<string, Values> {
  return Object.fromEntries(
    Object.entries(source.appletSettings).map(([id, entry]) => [
      id,
      appletValues(entry, activePageId),
    ]),
  );
}

import { isRecord } from '../automation/plain-data';
import { monitorRect, sameGeometry } from './geometry';
import { matchMonitor } from './monitor-identity';

export const CURRENT_POSITION = '__current_position__';

export type DisplayMonitor = {
  name: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
};

export type MonitorOption = {
  value: string;
  legacyName?: string;
  label: string;
  ordinal: number;
  primary: boolean;
  detail?: string;
  unavailable?: boolean;
  disabled?: boolean;
};

type MonitorNameMetadata = {
  name: string;
  friendly?: string;
  path?: string;
  index?: number;
  primary?: boolean;
};

function validNamedMetadata(rows: readonly unknown[]): Map<string, MonitorNameMetadata> {
  const byName = new Map<string, MonitorNameMetadata>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.name !== 'string' || !row.name.trim() || byName.has(row.name))
      continue;
    const friendly = typeof row.friendly === 'string' ? row.friendly.trim() : '';
    const path =
      typeof row.path === 'string' && row.path.trim() ? row.path.trim().toLowerCase() : undefined;
    const index =
      typeof row.index === 'number' && Number.isSafeInteger(row.index) && row.index > 0
        ? row.index
        : undefined;
    const primary = typeof row.primary === 'boolean' ? row.primary : undefined;
    if (!friendly && !path && index === undefined && primary === undefined) {
      continue;
    }
    byName.set(row.name, { name: row.name, friendly: friendly || undefined, path, index, primary });
  }
  return byName;
}

export function buildMonitorOptions(
  monitors: readonly DisplayMonitor[],
  metadata: readonly unknown[] = [],
  primaryMonitor: DisplayMonitor | null = null,
): MonitorOption[] {
  const byName = validNamedMetadata(metadata);
  const metadataPrimaryIndex = monitors.findIndex(
    (monitor) => !!monitor.name && byName.get(monitor.name)?.primary === true,
  );
  let fallbackPrimaryIndex = -1;
  if (metadataPrimaryIndex < 0 && primaryMonitor) {
    if (primaryMonitor.name) {
      fallbackPrimaryIndex = monitors.findIndex((monitor) => monitor.name === primaryMonitor.name);
    } else {
      fallbackPrimaryIndex = monitors.findIndex(
        (monitor) =>
          !monitor.name && sameGeometry(monitorRect(monitor), monitorRect(primaryMonitor)),
      );
    }
  }
  const primaryIndex = metadataPrimaryIndex >= 0 ? metadataPrimaryIndex : fallbackPrimaryIndex;

  return monitors
    .map((monitor, index) => {
      const nativeName = monitor.name || null;
      const info = nativeName ? byName.get(nativeName) : undefined;
      const ordinal = info?.index ?? index + 1;
      const resolution = `${monitor.size.width}×${monitor.size.height}`;
      // Screens without EDID data (Windows' "Generic Monitor") report no name, so they go by their number.
      const friendly =
        info?.friendly && info.friendly !== nativeName ? info.friendly : `Display ${ordinal}`;
      return {
        value: info?.path ?? nativeName ?? String(index),
        legacyName: nativeName ?? undefined,
        label: friendly,
        detail: resolution,
        ordinal,
        primary: index === primaryIndex,
      };
    })
    .sort((a, b) => a.ordinal - b.ordinal || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

export function monitorSelectOptions(
  options: readonly MonitorOption[],
  selected: string | null,
  savedLabel: string | null = null,
): MonitorOption[] {
  const local: MonitorOption[] = [
    { value: CURRENT_POSITION, label: 'Current position', ordinal: 0, primary: false },
  ];
  if (selected !== null && selected !== CURRENT_POSITION && !matchMonitor(options, selected)) {
    local.push({
      value: selected,
      label: savedLabel || 'Display',
      unavailable: true,
      ordinal: 0,
      primary: false,
      disabled: true,
    });
  }
  return [...local, ...options];
}

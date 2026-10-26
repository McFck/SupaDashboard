export const CURRENT_POSITION = '__current_position__';

export type DisplayMonitor = {
  name: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
};

export type MonitorOption = {
  value: string;
  label: string;
  ordinal: number;
  primary: boolean;
  disabled?: boolean;
};

type MonitorNameMetadata = { name: string; friendly?: string; index?: number; primary?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validNamedMetadata(rows: readonly unknown[]): Map<string, MonitorNameMetadata> {
  const byName = new Map<string, MonitorNameMetadata>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.name !== 'string' || !row.name.trim() || byName.has(row.name))
      continue;
    const friendly = typeof row.friendly === 'string' ? row.friendly.trim() : '';
    const index =
      typeof row.index === 'number' && Number.isSafeInteger(row.index) && row.index > 0
        ? row.index
        : undefined;
    const primary = typeof row.primary === 'boolean' ? row.primary : undefined;
    if (!friendly && index === undefined && primary === undefined) continue;
    byName.set(row.name, { name: row.name, friendly: friendly || undefined, index, primary });
  }
  return byName;
}

function sameGeometry(a: DisplayMonitor, b: DisplayMonitor): boolean {
  return (
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.size.width === b.size.width &&
    a.size.height === b.size.height
  );
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
        (monitor) => !monitor.name && sameGeometry(monitor, primaryMonitor),
      );
    }
  }
  const primaryIndex = metadataPrimaryIndex >= 0 ? metadataPrimaryIndex : fallbackPrimaryIndex;

  return monitors
    .map((monitor, index) => {
      const nativeName = monitor.name || null;
      const info = nativeName ? byName.get(nativeName) : undefined;
      const ordinal = info?.index ?? index + 1;
      const friendly = info?.friendly || nativeName?.trim() || 'Display';
      return {
        value: nativeName ?? String(index),
        label: `${friendly} · ${ordinal} · ${monitor.size.width}×${monitor.size.height}`,
        ordinal,
        primary: index === primaryIndex,
      };
    })
    .sort((a, b) => a.ordinal - b.ordinal || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

export function monitorSelectOptions(
  options: readonly MonitorOption[],
  selected: string | null,
): MonitorOption[] {
  const local: MonitorOption[] = [
    { value: CURRENT_POSITION, label: 'Current position', ordinal: 0, primary: false },
  ];
  if (
    selected !== null &&
    selected !== CURRENT_POSITION &&
    !options.some((option) => option.value === selected)
  ) {
    local.push({
      value: selected,
      label: `${selected} · Unavailable`,
      ordinal: 0,
      primary: false,
      disabled: true,
    });
  }
  return [...local, ...options];
}

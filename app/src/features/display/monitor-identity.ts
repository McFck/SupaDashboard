type MonitorIdentity = ({ name: string } | { value: string }) & { legacyName?: string };

function identity(monitor: MonitorIdentity) {
  return 'value' in monitor ? monitor.value : monitor.name;
}

function hardwareId(path: string) {
  // Windows monitor interface paths carry the PnP hardware ID before the instance and class GUID.
  const match = /^\\\\\?\\display#([a-z0-9]{7})#[^#]+#\{[\da-f-]+\}$/i.exec(path);
  return match?.[1].toLowerCase();
}

export function matchMonitor<T extends MonitorIdentity>(
  monitors: readonly T[],
  saved: string | null,
): T | undefined {
  if (!saved) {
    return undefined;
  }
  const exact = monitors.find((monitor) => identity(monitor) === saved);
  if (exact) {
    return exact;
  }
  const hardware = hardwareId(saved);
  if (!hardware) {
    return monitors.find((monitor) => monitor.legacyName === saved);
  }
  // An instance can change on reconnect. Two active screens with this hardware ID are ambiguous.
  const candidates = monitors.filter((monitor) => hardwareId(identity(monitor)) === hardware);
  return candidates.length === 1 ? candidates[0] : undefined;
}

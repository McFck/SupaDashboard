import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chosenMonitorMissing, type MonitorGeometry } from '../features/display/geometry';

const native = vi.hoisted(() => ({
  screens: [] as MonitorGeometry[],
  metadata: vi.fn<() => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: () => native.metadata() }));
vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: async () => native.screens,
  currentMonitor: async () => native.screens[0] ?? null,
  primaryMonitor: async () => native.screens[0] ?? null,
}));
vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  native.screens = [
    {
      name: 'DISPLAY17',
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
      scaleFactor: 1,
    },
  ];
  native.metadata.mockReset();
  native.metadata.mockResolvedValue([{ name: 'DISPLAY17', path: 'MONITOR#Tablet' }]);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it.each(['rejected', 'partial', 'malformed'] as const)(
  'does not report a connected monitor as missing after a %s identity query',
  async (failure) => {
    const { connectedMonitors } = await import('./window');
    await connectedMonitors();
    if (failure === 'rejected') {
      native.metadata.mockRejectedValueOnce(new Error('DisplayConfig unavailable'));
    } else {
      native.metadata.mockResolvedValueOnce(
        failure === 'partial' ? [{ name: 'DISPLAY17', friendly: 'Tablet', path: '' }] : null,
      );
    }
    const snapshot = await connectedMonitors();
    expect(chosenMonitorMissing(snapshot.screens, 'monitor#tablet')).toBe(false);
    expect(snapshot.current?.name).toBe('monitor#tablet');
    expect(snapshot.primary?.name).toBe('monitor#tablet');
  },
);

it('does not reuse a disconnected monitor identity when Windows reuses its display name', async () => {
  const { connectedMonitors } = await import('./window');
  await connectedMonitors();
  const screens = native.screens;
  native.screens = [];
  expect(chosenMonitorMissing((await connectedMonitors()).screens, 'monitor#tablet')).toBe(true);
  native.screens = screens;
  native.metadata.mockResolvedValue([]);
  expect(chosenMonitorMissing((await connectedMonitors()).screens, 'monitor#tablet')).toBe(true);
});

it('replaces a remembered identity when Windows reports a different device on the same display name', async () => {
  const { connectedMonitors } = await import('./window');
  await connectedMonitors();
  native.metadata.mockResolvedValue([{ name: 'DISPLAY17', path: 'MONITOR#Replacement' }]);
  const { screens } = await connectedMonitors();
  expect(chosenMonitorMissing(screens, 'monitor#tablet')).toBe(true);
  expect(chosenMonitorMissing(screens, 'monitor#replacement')).toBe(false);
});

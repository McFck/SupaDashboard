import { describe, expect, it } from 'vitest';
import { buildMonitorOptions, CURRENT_POSITION, monitorSelectOptions } from './monitor-options';

const monitor = (name: string | null, x: number, y: number, width: number, height: number) => ({
  name, position: { x, y }, size: { width, height },
});

describe('monitor options', () => {
  it('joins reversed metadata by exact native name and sorts by its one-based ordinal', () => {
    const monitors = [monitor('DISPLAY-B', 1920, -200, 2560, 1440), monitor('DISPLAY-A', -2560, 0, 2560, 1440)];
    const options = buildMonitorOptions(monitors, [
      { name: 'DISPLAY-A', friendly: 'Dell U2720Q', index: 2, primary: false },
      { name: 'DISPLAY-B', friendly: '  ASUS  ', index: 1, primary: true },
      { name: 'DISCONNECTED', friendly: 'Extra', index: 3, primary: false },
    ]);
    expect(options.map(option => [option.value, option.label, option.primary])).toEqual([
      ['DISPLAY-B', 'ASUS · 1 · 2560×1440', true],
      ['DISPLAY-A', 'Dell U2720Q · 2 · 2560×1440', false],
    ]);
  });

  it('uses physical resolution and only marks primary from metadata or the Tauri primary monitor', () => {
    const monitors = [monitor('LEFT', -1920, -300, 1920, 1080), monitor('RIGHT', 0, 0, 3840, 2160)];
    expect(buildMonitorOptions(monitors).map(option => option.primary)).toEqual([false, false]);
    expect(buildMonitorOptions(monitors, [], monitors[0]).map(option => option.primary)).toEqual([true, false]);
    expect(buildMonitorOptions(monitors, [{ name: 'RIGHT', primary: true }], monitors[0]).map(option => option.primary)).toEqual([false, true]);
    expect(buildMonitorOptions(monitors)[1].label).toBe('RIGHT · 2 · 3840×2160');
  });

  it('uses the first valid duplicate named row, ignores malformed metadata, and falls back for invalid ordinals', () => {
    const options = buildMonitorOptions([monitor('A', 0, 0, 1920, 1080), monitor('B', 1920, 0, 1920, 1080)], [
      null,
      { name: 'A', index: 0, friendly: '   ', primary: 'yes' },
      { name: 'A', friendly: 'First name', index: 2, primary: false },
      { name: 'A', friendly: 'Second name', index: 9, primary: true },
      { name: 'B', index: -1 },
      { name: 'OFFLINE', friendly: 'Not connected', index: 8, primary: true },
    ]);
    expect(options).toEqual([
      { value: 'A', label: 'First name · 2 · 1920×1080', ordinal: 2, primary: false },
      { value: 'B', label: 'B · 2 · 1920×1080', ordinal: 2, primary: false },
    ]);
  });

  it('uses enumeration identity for unnamed monitors and full geometry only for an unnamed primary', () => {
    const monitors = [monitor('NAMED', 0, 0, 1920, 1080), monitor(null, -1280, 0, 1280, 1024), monitor(null, 1920, 0, 1280, 1024)];
    const options = buildMonitorOptions(monitors, [], monitor(null, 1920, 0, 1280, 1024));
    expect(options.find(option => option.value === '1')).toMatchObject({ label: 'Display · 2 · 1280×1024', primary: false });
    expect(options.find(option => option.value === '2')).toMatchObject({ label: 'Display · 3 · 1280×1024', primary: true });
  });

  it('keeps Current position and preserves a disconnected saved native name as disabled', () => {
    const options = buildMonitorOptions([monitor('CONNECTED', 0, 0, 1920, 1080)]);
    expect(monitorSelectOptions(options, null)[0]).toMatchObject({ value: CURRENT_POSITION, label: 'Current position' });
    expect(monitorSelectOptions(options, 'MISSING')[1]).toMatchObject({ value: 'MISSING', label: 'MISSING · Unavailable', disabled: true });
    expect(monitorSelectOptions(options, 'CONNECTED').map(option => option.value)).toEqual([CURRENT_POSITION, 'CONNECTED']);
  });
});

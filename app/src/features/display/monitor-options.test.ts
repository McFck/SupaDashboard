import { expect, it } from 'vitest';
import { buildMonitorOptions, CURRENT_POSITION, monitorSelectOptions } from './monitor-options';

const monitor = (name: string | null, x = 0) => ({
  name,
  position: { x, y: 0 },
  size: { width: 1920, height: 1080 },
});

it('keeps a readable disconnected selection and uses the device path after GDI renumbering', () => {
  const options = buildMonitorOptions(
    [monitor('DISPLAY17')],
    [{ name: 'DISPLAY17', friendly: 'DELL U2723QE', path: 'MONITOR#Stable' }],
  );
  expect(options[0]).toMatchObject({ value: 'monitor#stable', label: 'DELL U2723QE' });
  expect(monitorSelectOptions([], 'monitor#stable', options[0].label)[1]).toMatchObject({
    value: 'monitor#stable',
    label: 'DELL U2723QE',
    disabled: true,
  });
  expect(
    buildMonitorOptions(
      [monitor('DISPLAY22')],
      [{ name: 'DISPLAY22', friendly: 'DELL U2723QE', path: 'MONITOR#Stable' }],
    )[0].value,
  ).toBe(options[0].value);
  expect(buildMonitorOptions([monitor('DISPLAY17')])[0].label).toBe('1920×1080');
  expect(monitorSelectOptions(options, 'DISPLAY17')).toHaveLength(2);
});

it.each([
  {
    monitors: [monitor('B'), monitor('A')],
    metadata: [
      { name: 'A', index: 2 },
      { name: 'B', index: 1, primary: true },
    ],
    primary: null,
    expected: [
      ['B', true],
      ['A', false],
    ],
  },
  {
    monitors: [monitor('A'), monitor('B')],
    metadata: [
      null,
      { name: 'A', index: 0 },
      { name: 'A', index: 2 },
      { name: 'A', primary: true },
    ],
    primary: monitor('B'),
    expected: [
      ['A', false],
      ['B', true],
    ],
  },
  {
    monitors: [monitor(null, -1920), monitor(null, 1920)],
    metadata: [],
    primary: monitor(null, 1920),
    expected: [
      ['0', false],
      ['1', true],
    ],
  },
])(
  'keeps monitor identity and disconnected saved selections: $expected',
  ({ monitors, metadata, primary, expected }) => {
    const options = buildMonitorOptions(monitors, metadata, primary);
    expect(options.map(({ value, primary }) => [value, primary])).toEqual(expected);
    const choices = monitorSelectOptions(options, 'MISSING');
    expect(choices[0].value).toBe(CURRENT_POSITION);
    expect(choices[1]).toMatchObject({ value: 'MISSING', disabled: true });
  },
);

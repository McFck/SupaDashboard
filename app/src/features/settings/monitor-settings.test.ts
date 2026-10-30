import { expect, it } from 'vitest';
import { DEFAULTS } from './defaults';
import { migrate } from './normalize';
import { serializeSettings } from './state.svelte';

it('upgrades v8 without losing a disconnected monitor choice and round-trips its saved label', () => {
  const old = {
    ...structuredClone(DEFAULTS),
    version: 8,
    display: { monitor: '\\\\.\\DISPLAY17' },
  };
  const original = structuredClone(old);
  const migrated = migrate(old);
  expect(migrated.display).toMatchObject({ monitor: old.display.monitor, monitorLabel: null });
  expect(old).toEqual(original);
  migrated.display.monitorLabel = 'DELL U2723QE';
  expect(migrate(JSON.parse(serializeSettings(migrated))).display).toEqual(migrated.display);
  expect(() =>
    migrate({ ...migrated, display: { ...migrated.display, monitorLabel: {} } }),
  ).toThrow('Monitor label');
});

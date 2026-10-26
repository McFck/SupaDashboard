import { describe, expect, it } from 'vitest';
import { parseVariableText, VariableStore, type VariableDefinition } from './variables';

const def = (
  id: string,
  name: string,
  type: VariableDefinition['type'],
  initialValue: VariableDefinition['initialValue'],
  extra: Partial<VariableDefinition> = {},
): VariableDefinition => ({
  id,
  name,
  type,
  initialValue,
  owner: 'user',
  persistent: true,
  readOnly: false,
  ...extra,
});

describe('typed variables', () => {
  it('validates each type and parses only complete input', () => {
    expect(parseVariableText('boolean', 'true')).toBe(true);
    expect(parseVariableText('boolean', 'false')).toBe(false);
    expect(() => parseVariableText('boolean', 'yes')).toThrow();
    expect(parseVariableText('integer', '-12')).toBe(-12);
    expect(() => parseVariableText('integer', '12.2')).toThrow();
    expect(() => parseVariableText('integer', '9007199254740992')).toThrow();
    expect(parseVariableText('float', '.5e2')).toBe(50);
    for (const input of ['1x', 'NaN', 'Infinity', '1e999'])
      expect(() => parseVariableText('float', input)).toThrow();
    expect(parseVariableText('string', '  exact value  ')).toBe('  exact value  ');
  });

  it('enforces unique names, keeps aliases on rename and removes by stable ID', () => {
    const store = new VariableStore();
    store.createUser({ id: 'v1', name: ' Count ', type: 'integer', initialValue: 0 });
    expect(() =>
      store.createUser({ id: 'v2', name: 'count', type: 'string', initialValue: '' }),
    ).toThrow('already exists');
    store.rename('v1', 'Total');
    expect(store.findByName(' count ')?.definition.id).toBe('v1');
    expect(store.findByName('TOTAL')?.definition.id).toBe('v1');
    expect(() =>
      store.createUser({ id: 'v2', name: 'COUNT', type: 'boolean', initialValue: false }),
    ).toThrow('already exists');
    store.remove('v1');
    expect(store.findByName('Count')).toBeUndefined();
  });

  it('checks ownership and read-only values while allowing their plugin owner to update', () => {
    const store = new VariableStore();
    store.define(
      {
        ...def('clock.time', 'clock.time', 'string', '12:00', {
          owner: 'core',
          persistent: false,
          readOnly: true,
        }),
      },
      'core',
    );
    store.createUser({ id: 'user.count', name: 'count', type: 'integer', initialValue: 0 });
    expect(() => store.set('clock.time', '13:00')).toThrow('read-only');
    expect(() => store.set('user.count', 1, 'core')).toThrow('another owner');
    expect(store.set('clock.time', '13:00', 'core')).toBe(true);
    expect(store.getValue('clock.time')).toBe('13:00');
    expect(() => store.remove('clock.time')).toThrow('another owner');
  });

  it('notifies only for actual changes and exposes immutable snapshots', () => {
    const store = new VariableStore();
    store.createUser({ id: 'flag', name: 'flag', type: 'boolean', initialValue: false });
    const revisions: number[] = [];
    const stop = store.subscribe((snapshot) => revisions.push(snapshot.revision));
    expect(store.set('flag', false)).toBe(false);
    expect(store.toggle('flag')).toBe(true);
    expect(store.setText('flag', 'true')).toBe(false);
    expect(revisions).toHaveLength(1);
    const snapshot = store.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.records.flag)).toBe(true);
    expect(Object.isFrozen(snapshot.records.flag.definition)).toBe(true);
    stop();
    store.set('flag', false);
    expect(revisions).toHaveLength(1);
  });

  it('increments numeric types safely and rejects wrong operations without mutation', () => {
    const store = new VariableStore();
    store.createUser({
      id: 'i',
      name: 'count',
      type: 'integer',
      initialValue: Number.MAX_SAFE_INTEGER,
    });
    expect(() => store.increment('i')).toThrow('safe range');
    expect(store.getValue('i')).toBe(Number.MAX_SAFE_INTEGER);
    store.createUser({ id: 'f', name: 'ratio', type: 'float', initialValue: 1.5 });
    expect(store.increment('f', 0.25)).toBe(true);
    expect(store.getValue('f')).toBe(1.75);
    expect(() => store.toggle('f')).toThrow('Boolean');
    expect(() => store.set('i', '2')).toThrow('does not match');
  });

  it('persists only persistent records and restores plugin owners as unavailable', () => {
    const store = new VariableStore();
    store.createUser({ id: 'recording', name: 'recording', type: 'boolean', initialValue: false });
    store.define(
      {
        ...def('clock.day', 'clock.day', 'string', 'Monday', {
          owner: 'core',
          persistent: false,
          readOnly: true,
        }),
      },
      'core',
    );
    store.define(
      {
        ...def('plugin.value', 'plugin.value', 'float', 0.25, {
          owner: 'plugin',
          persistent: true,
        }),
      },
      'plugin',
    );
    store.set('plugin.value', 0.5, 'plugin');
    const saved = store.serializePersistent();
    expect(saved.records.map((record) => record.definition.id)).toEqual([
      'recording',
      'plugin.value',
    ]);
    const restored = new VariableStore(saved);
    expect(restored.getValue('plugin.value')).toBe(0.5);
    expect(restored.get('plugin.value')?.definition.available).toBe(false);
    restored.setOwnerAvailable('plugin', true);
    expect(restored.get('plugin.value')?.definition.available).toBe(true);
  });
});

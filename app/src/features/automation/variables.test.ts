import { describe, expect, it } from 'vitest';
import {
  parseVariableText,
  validVariableSnapshot,
  VariableStore,
  type VariableDefinition,
} from './variables';

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
  it('upgrades v1 variable records without changing values or adding restrictions', () => {
    const input = {
      version: 1,
      records: [{ definition: def('text', 'Text', 'string', ''), value: 'custom value' }],
    };
    const original = structuredClone(input);
    const variables = new VariableStore(input);
    expect(variables.needsRecovery).toBe(false);
    expect(variables.serializePersistent()).toEqual({ ...input, version: 2 });
    expect(input).toEqual(original);
  });
  it('rejects enum values and malformed options at definition, write, persistence and mirror boundaries', () => {
    const definition = def('mode', 'Mode', 'string', 'off', {
      options: ['off', 'shuffle', 'smart'],
    });
    const store = new VariableStore();
    store.define(definition);
    definition.options?.push('outside');
    expect(() => store.set('mode', 'outside')).toThrow('allowed option');
    store.set('mode', 'smart');
    expect(() => store.set('mode', 'on')).toThrow('allowed option');
    expect(validVariableSnapshot(store.snapshot())).toBe(true);
    expect(new VariableStore(store.serializePersistent()).getValue('mode')).toBe('smart');
    for (const options of [[], ['off', 'off'], [true], 'off']) {
      const invalid = { ...definition, options };
      const saved = { version: 1, records: [{ definition: invalid, value: 'off' }] };
      expect(new VariableStore(saved).needsRecovery).toBe(true);
      expect(validVariableSnapshot({ revision: 0, records: { mode: saved.records[0] } })).toBe(
        false,
      );
    }
    expect(() => store.define({ ...definition, initialValue: 'unknown' })).toThrow(
      'allowed option',
    );
    const saved = store.serializePersistent();
    saved.records[0].value = 'unknown';
    expect(new VariableStore(saved).needsRecovery).toBe(true);
    expect(validVariableSnapshot({ revision: 0, records: { mode: saved.records[0] } })).toBe(false);
  });
  it.each([{}, { version: 9, records: [] }, { version: 1, records: {} }])(
    'starts with an empty recoverable store for an unsupported envelope: %j',
    (raw) => {
      const store = new VariableStore(raw);
      expect(store.snapshot().records).toEqual({});
      expect(store.needsRecovery).toBe(true);
    },
  );

  it('restores valid records around damaged entries without losing the first duplicate ID or name', () => {
    const good = { definition: def('good', 'Good', 'integer', 0), value: 42 };
    const tail = { definition: def('tail', 'Tail', 'string', ''), value: 'kept' };
    const raw = {
      version: 1,
      records: [
        good,
        null,
        { definition: def('bad-value', 'Bad value', 'integer', 0), value: 'oops' },
        { definition: def('bad-initial', 'Bad initial', 'integer', 'oops'), value: 1 },
        { definition: { ...def('bad-name', 'Name', 'string', ''), name: null }, value: '' },
        { definition: { ...def('bad-alias', 'Alias', 'string', ''), aliases: {} }, value: '' },
        { definition: def('good', 'Duplicate ID', 'integer', 0), value: 99 },
        { definition: def('duplicate-name', 'Good', 'integer', 0), value: 99 },
        tail,
      ],
    };
    const original = structuredClone(raw);
    const store = new VariableStore(raw);
    expect(store.getValue('good')).toBe(42);
    expect(store.getValue('tail')).toBe('kept');
    expect(store.serializePersistent().records.map((record) => record.definition.id)).toEqual([
      'good',
      'tail',
    ]);
    expect(store.needsRecovery).toBe(true);
    expect(raw).toEqual(original);
  });

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
  });
});

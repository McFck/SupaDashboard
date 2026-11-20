import { freezeDeep, isRecord } from './plain-data';
import { upgradeVariables } from '../settings/upgrade';

export type VariableType = 'boolean' | 'integer' | 'float' | 'string';
export type VariableValue = boolean | number | string;
export const VARIABLE_TYPES: readonly VariableType[] = ['boolean', 'integer', 'float', 'string'];
export type VariableDefinition = {
  id: string;
  name: string;
  type: VariableType;
  owner: string;
  persistent: boolean;
  readOnly: boolean;
  initialValue: VariableValue;
  /** Closed set of values for string variables. */
  options?: string[];
  aliases?: string[];
  available?: boolean;
};
export type VariableRecord = { definition: VariableDefinition; value: VariableValue };
export type VariableEnvelope = {
  version: 2;
  records: { definition: Omit<VariableDefinition, 'available'>; value: VariableValue }[];
};
export type VariableSnapshot = {
  revision: number;
  records: Readonly<Record<string, Readonly<VariableRecord>>>;
};

function normalizeName(value: string) {
  const name = value.trim();
  if (!name) throw new Error('Variable name is required');
  return name;
}

function assertValue(
  type: VariableType,
  value: unknown,
  options?: string[],
): asserts value is VariableValue {
  if (options && (typeof value !== 'string' || !options.includes(value))) {
    throw new Error('Value is not an allowed option');
  }
  if (type === 'boolean' && typeof value === 'boolean') return;
  if (type === 'integer' && typeof value === 'number' && Number.isSafeInteger(value)) return;
  if (type === 'float' && typeof value === 'number' && Number.isFinite(value)) return;
  if (type === 'string' && typeof value === 'string') return;
  throw new Error(`Value does not match ${type}`);
}

export function parseVariableText(type: VariableType, text: string): VariableValue {
  if (type === 'string') return text;
  const value = text.trim();
  if (type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error('Use true or false');
  }
  if (type === 'integer') {
    if (!/^[+-]?\d+$/.test(value)) throw new Error('Use a whole number');
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error('Integer is outside the safe range');
    return parsed;
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw new Error('Use a number');
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Number must be finite');
  return parsed;
}

function nameKey(name: string) {
  return normalizeName(name).toLocaleLowerCase();
}

function isDefinition(value: unknown): value is VariableDefinition {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    !!value.id &&
    typeof value.name === 'string' &&
    !!value.name.trim() &&
    typeof value.owner === 'string' &&
    !!value.owner &&
    VARIABLE_TYPES.includes(value.type as VariableType) &&
    typeof value.persistent === 'boolean' &&
    typeof value.readOnly === 'boolean' &&
    (value.options === undefined ||
      (value.type === 'string' &&
        Array.isArray(value.options) &&
        value.options.length > 0 &&
        value.options.every((option: unknown) => typeof option === 'string') &&
        new Set(value.options).size === value.options.length)) &&
    (value.aliases === undefined ||
      (Array.isArray(value.aliases) &&
        value.aliases.every((alias: unknown) => typeof alias === 'string' && !!alias.trim())))
  );
}

export function validVariableSnapshot(value: unknown): value is VariableSnapshot {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || !isRecord(value.records)) {
    return false;
  }
  return Object.entries(value.records).every(([id, record]) => {
    if (!isRecord(record) || !isDefinition(record.definition) || record.definition.id !== id) {
      return false;
    }
    try {
      const { type, initialValue, options } = record.definition;
      assertValue(type, initialValue, options);
      assertValue(type, record.value, options);
      return true;
    } catch {
      return false;
    }
  });
}

export class VariableStore {
  readonly needsRecovery: boolean = false;
  private records = new Map<string, VariableRecord>();
  private revision = 0;
  private listeners = new Set<(snapshot: VariableSnapshot, persistentChanged: boolean) => void>();

  constructor(envelope?: unknown) {
    if (envelope === undefined || envelope === null) {
      return;
    }
    const saved = upgradeVariables(envelope);
    if (!saved) {
      this.needsRecovery = true;
      return;
    }
    for (const raw of saved.records) {
      try {
        if (!isRecord(raw) || !isDefinition(raw.definition)) {
          throw new Error('Malformed variable record');
        }
        const definition = raw.definition;
        assertValue(definition.type, definition.initialValue, definition.options);
        assertValue(definition.type, raw.value, definition.options);
        if (this.records.has(definition.id)) {
          throw new Error('Duplicate variable ID');
        }
        const record = this.normalizeRecord({
          definition: { ...definition, available: definition.owner === 'user' },
          value: raw.value,
        });
        this.assertUniqueName(
          record.definition.name,
          record.definition.aliases,
          record.definition.id,
        );
        this.records.set(record.definition.id, record);
      } catch {
        this.needsRecovery = true;
      }
    }
  }

  snapshot(): VariableSnapshot {
    const records = Object.fromEntries(
      [...this.records].map(([id, record]) => [id, structuredClone(record)]),
    );
    return freezeDeep({ revision: this.revision, records });
  }

  subscribe(listener: (snapshot: VariableSnapshot, persistentChanged: boolean) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(id: string) {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  getValue(id: string) {
    return this.records.get(id)?.value;
  }

  findByName(name: string) {
    const key = nameKey(name);
    const record = [...this.records.values()].find((item) =>
      [item.definition.name, ...(item.definition.aliases ?? [])].some(
        (alias) => nameKey(alias) === key,
      ),
    );
    return record ? structuredClone(record) : undefined;
  }

  define(definition: Omit<VariableDefinition, 'available'>, actor: string = 'user') {
    if (!isDefinition(definition)) throw new Error('Malformed variable definition');
    const owner = definition.owner;
    if (actor === 'user' ? owner !== 'user' : owner !== actor)
      throw new Error('Variable owner does not match');
    const name = normalizeName(definition.name);
    assertValue(definition.type, definition.initialValue, definition.options);
    const current = this.records.get(definition.id);
    if (current && current.definition.owner !== owner)
      throw new Error('Variable ID belongs to another owner');
    this.assertUniqueName(name, definition.aliases, definition.id);
    const value =
      current && current.definition.type === definition.type
        ? current.value
        : definition.initialValue;
    const next = this.normalizeRecord({
      definition: { ...definition, name, available: true },
      value,
    });
    assertValue(next.definition.type, next.value, next.definition.options);
    this.records.set(next.definition.id, next);
    this.changed(next.definition.persistent || current?.definition.persistent === true);
    return structuredClone(next);
  }

  createUser(input: {
    id: string;
    name: string;
    type: VariableType;
    initialValue: VariableValue;
    persistent?: boolean;
  }) {
    return this.define(
      { ...input, owner: 'user', persistent: input.persistent ?? true, readOnly: false },
      'user',
    );
  }

  rename(id: string, nextName: string, actor: string = 'user') {
    const current = this.mustGet(id);
    this.assertOwner(current, actor);
    const name = normalizeName(nextName);
    this.assertUniqueName(name, current.definition.aliases, id);
    const aliases = [
      ...new Set([...(current.definition.aliases ?? []), current.definition.name]),
    ].filter((alias) => nameKey(alias) !== nameKey(name));
    this.records.set(id, { ...current, definition: { ...current.definition, name, aliases } });
    this.changed(current.definition.persistent);
  }

  setPersistent(id: string, persistent: boolean, actor: string = 'user') {
    const current = this.mustGet(id);
    this.assertOwner(current, actor);
    if (current.definition.persistent === persistent) return false;
    this.records.set(id, { ...current, definition: { ...current.definition, persistent } });
    this.changed(true);
    return true;
  }

  remove(id: string, actor: string = 'user') {
    const current = this.mustGet(id);
    this.assertOwner(current, actor);
    this.records.delete(id);
    this.changed(current.definition.persistent);
  }

  /** Match the state after a restart with the plugin absent, preserving its saved values. */
  undefine(id: string, owner: string) {
    const current = this.records.get(id);
    if (!current || current.definition.owner !== owner) {
      return;
    }
    if (current.definition.persistent) {
      current.definition.available = false;
    } else {
      this.records.delete(id);
    }
    this.changed(false);
  }

  set(id: string, value: unknown, actor: string = 'user') {
    const current = this.mustGet(id);
    this.assertWritable(current, actor);
    assertValue(current.definition.type, value, current.definition.options);
    if (current.value === value) return false;
    this.records.set(id, { ...current, value });
    this.changed(current.definition.persistent);
    return true;
  }

  serializePersistent(): VariableEnvelope {
    return {
      version: 2,
      records: [...this.records.values()]
        .filter((record) => record.definition.persistent)
        .map((record) => {
          const { available: _available, ...definition } = record.definition;
          return { definition: structuredClone(definition), value: record.value };
        }),
    };
  }

  private normalizeRecord(record: VariableRecord): VariableRecord {
    return {
      definition: {
        ...record.definition,
        name: normalizeName(record.definition.name),
        options: record.definition.options?.slice(),
        aliases: record.definition.aliases?.map(normalizeName),
      },
      value: record.value,
    };
  }

  private assertUniqueName(name: string, aliases: string[] | undefined, exceptId: string) {
    const keys = new Set([name, ...(aliases ?? [])].map(nameKey));
    for (const [id, record] of this.records) {
      if (id === exceptId) continue;
      const existing = [record.definition.name, ...(record.definition.aliases ?? [])].map(nameKey);
      if (existing.some((key) => keys.has(key))) throw new Error('Variable name already exists');
    }
  }

  private mustGet(id: string) {
    const record = this.records.get(id);
    if (!record) throw new Error('Variable is unavailable');
    return record;
  }

  private assertOwner(record: VariableRecord, actor: string) {
    if (record.definition.owner !== actor) throw new Error('Variable belongs to another owner');
  }

  private assertWritable(record: VariableRecord, actor: string) {
    if (actor === 'user' && record.definition.readOnly) throw new Error('Variable is read-only');
    if (actor !== 'user' && record.definition.owner !== actor)
      throw new Error('Plugin cannot write another owner’s variable');
  }

  private changed(persistentChanged: boolean) {
    this.revision++;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot, persistentChanged);
    }
  }
}

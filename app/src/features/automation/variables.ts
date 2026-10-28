export type VariableType = 'boolean' | 'integer' | 'float' | 'string';
export type VariableValue = boolean | number | string;
export type VariableDefinition = {
  id: string;
  name: string;
  type: VariableType;
  owner: string;
  persistent: boolean;
  readOnly: boolean;
  initialValue: VariableValue;
  suggestions?: { value: string; label: string }[];
  aliases?: string[];
  available?: boolean;
};
export type VariableRecord = { definition: VariableDefinition; value: VariableValue };
export type VariableEnvelope = {
  version: 1;
  records: { definition: Omit<VariableDefinition, 'available'>; value: VariableValue }[];
};
export type VariableSnapshot = {
  revision: number;
  records: Readonly<Record<string, Readonly<VariableRecord>>>;
};
export type VariableActor = 'user' | string;

function normalizeName(value: string) {
  const name = value.trim();
  if (!name) throw new Error('Variable name is required');
  return name;
}

function assertValue(type: VariableType, value: unknown): asserts value is VariableValue {
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

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

function copyRecord(record: VariableRecord): VariableRecord {
  return structuredClone(record);
}

function nameKey(name: string) {
  return normalizeName(name).toLocaleLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    (value.type === 'boolean' ||
      value.type === 'integer' ||
      value.type === 'float' ||
      value.type === 'string') &&
    typeof value.persistent === 'boolean' &&
    typeof value.readOnly === 'boolean' &&
    (value.aliases === undefined ||
      (Array.isArray(value.aliases) &&
        value.aliases.every((alias: unknown) => typeof alias === 'string' && !!alias.trim()))) &&
    (value.suggestions === undefined ||
      (Array.isArray(value.suggestions) &&
        value.suggestions.every(
          (option: unknown) =>
            isRecord(option) &&
            typeof option.value === 'string' &&
            typeof option.label === 'string',
        )))
  );
}

export class VariableStore {
  readonly needsRecovery: boolean = false;
  private records = new Map<string, VariableRecord>();
  private revision = 0;
  private listeners = new Set<(snapshot: VariableSnapshot) => void>();

  constructor(envelope?: unknown) {
    if (envelope === undefined || envelope === null) {
      return;
    }
    if (!isRecord(envelope) || envelope.version !== 1 || !Array.isArray(envelope.records)) {
      this.needsRecovery = true;
      return;
    }
    for (const raw of envelope.records) {
      try {
        if (!isRecord(raw) || !isDefinition(raw.definition)) {
          throw new Error('Malformed variable record');
        }
        const definition = raw.definition;
        assertValue(definition.type, definition.initialValue);
        assertValue(definition.type, raw.value);
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
      [...this.records].map(([id, record]) => [id, copyRecord(record)]),
    );
    return freezeDeep({ revision: this.revision, records });
  }

  subscribe(listener: (snapshot: VariableSnapshot) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(id: string) {
    const record = this.records.get(id);
    return record ? copyRecord(record) : undefined;
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
    return record ? copyRecord(record) : undefined;
  }

  define(definition: Omit<VariableDefinition, 'available'>, actor: VariableActor = 'user') {
    if (!definition.id) throw new Error('Variable ID is required');
    const owner = definition.owner;
    if (actor === 'user' ? owner !== 'user' : owner !== actor)
      throw new Error('Variable owner does not match');
    const name = normalizeName(definition.name);
    assertValue(definition.type, definition.initialValue);
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
    assertValue(next.definition.type, next.value);
    this.records.set(next.definition.id, next);
    this.changed();
    return copyRecord(next);
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

  rename(id: string, nextName: string, actor: VariableActor = 'user') {
    const current = this.mustGet(id);
    this.assertOwner(current, actor);
    const name = normalizeName(nextName);
    this.assertUniqueName(name, current.definition.aliases, id);
    const aliases = [
      ...new Set([...(current.definition.aliases ?? []), current.definition.name]),
    ].filter((alias) => nameKey(alias) !== nameKey(name));
    this.records.set(id, { ...current, definition: { ...current.definition, name, aliases } });
    this.changed();
  }

  setPersistent(id: string, persistent: boolean, actor: VariableActor = 'user') {
    const current = this.mustGet(id);
    this.assertOwner(current, actor);
    if (current.definition.persistent === persistent) return false;
    this.records.set(id, { ...current, definition: { ...current.definition, persistent } });
    this.changed();
    return true;
  }

  remove(id: string, actor: VariableActor = 'user') {
    const current = this.mustGet(id);
    this.assertOwner(current, actor);
    this.records.delete(id);
    this.changed();
  }

  set(id: string, value: unknown, actor: VariableActor = 'user') {
    const current = this.mustGet(id);
    this.assertWritable(current, actor);
    assertValue(current.definition.type, value);
    if (current.value === value) return false;
    this.records.set(id, { ...current, value });
    this.changed();
    return true;
  }

  setText(id: string, text: string, actor: VariableActor = 'user') {
    const record = this.mustGet(id);
    return this.set(id, parseVariableText(record.definition.type, text), actor);
  }

  toggle(id: string, actor: VariableActor = 'user') {
    const record = this.mustGet(id);
    if (record.definition.type !== 'boolean') throw new Error('Toggle requires a Boolean variable');
    return this.set(id, !record.value, actor);
  }

  increment(id: string, by = 1, actor: VariableActor = 'user') {
    const record = this.mustGet(id);
    if (record.definition.type !== 'integer' && record.definition.type !== 'float')
      throw new Error('Increment requires a numeric variable');
    if (!Number.isFinite(by)) throw new Error('Increment must be finite');
    const value = Number(record.value) + by;
    if (record.definition.type === 'integer' && !Number.isSafeInteger(value))
      throw new Error('Integer is outside the safe range');
    if (record.definition.type === 'float' && !Number.isFinite(value))
      throw new Error('Number must be finite');
    assertValue(record.definition.type, value);
    return this.set(id, value, actor);
  }

  setOwnerAvailable(owner: string, available: boolean) {
    let changed = false;
    for (const [id, record] of this.records)
      if (record.definition.owner === owner && record.definition.available !== available) {
        this.records.set(id, { ...record, definition: { ...record.definition, available } });
        changed = true;
      }
    if (changed) this.changed();
  }

  serializePersistent(): VariableEnvelope {
    return {
      version: 1,
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
        aliases: record.definition.aliases?.map(normalizeName),
        suggestions: record.definition.suggestions?.map((option) => ({ ...option })),
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

  private assertOwner(record: VariableRecord, actor: VariableActor) {
    if (record.definition.owner !== actor) throw new Error('Variable belongs to another owner');
  }

  private assertWritable(record: VariableRecord, actor: VariableActor) {
    if (actor === 'user' && record.definition.readOnly) throw new Error('Variable is read-only');
    if (actor !== 'user' && record.definition.owner !== actor)
      throw new Error('Plugin cannot write another owner’s variable');
  }

  private changed() {
    this.revision++;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

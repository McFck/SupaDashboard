import { afterEach, describe, expect, it, vi } from 'vitest';
import { VariableStore } from '../../features/automation/variables';

const native = vi.hoisted(() => ({ enabled: false, load: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => native.enabled }));
vi.mock('@tauri-apps/plugin-store', () => ({ load: native.load }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
import { loadVariableState } from './variable-persistence';

const key = 'supadashboard:variables:v1';
const empty = () => new VariableStore().serializePersistent();

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('variable persistence recovery', () => {
  it.each(['{truncated', 'null', '{"version":99,"records":[]}', '{"version":1,"records":[null]}'])(
    'preserves the exact corrupt browser value before saving a replacement: %s',
    async (raw) => {
      native.enabled = false;
      const values = new Map([[key, raw]]);
      vi.stubGlobal('localStorage', {
        getItem: (id: string) => values.get(id) ?? null,
        setItem: (id: string, value: string) => values.set(id, value),
      });
      const { variables, persistence } = await loadVariableState();
      expect(variables.snapshot().records).toEqual({});
      expect(values.get(key)).toBe(raw);
      variables.createUser({ id: 'new', name: 'New', type: 'integer', initialValue: 7 });
      await persistence.save(variables.serializePersistent());
      expect([...values].filter(([id]) => id !== key).map(([, value]) => value)).toEqual([raw]);
      expect(new VariableStore(JSON.parse(values.get(key)!)).getValue('new')).toBe(7);
    },
  );

  it('keeps the browser original if its recovery copy cannot be written and allows a later retry', async () => {
    native.enabled = false;
    const raw = '{truncated';
    const values = new Map([[key, raw]]);
    let fail = true;
    vi.stubGlobal('localStorage', {
      getItem: (id: string) => values.get(id) ?? null,
      setItem: (id: string, value: string) => {
        if (fail) {
          throw new Error('Quota exceeded');
        }
        values.set(id, value);
      },
    });
    const { persistence } = await loadVariableState();
    await expect(persistence.save(empty())).rejects.toThrow('Quota exceeded');
    expect(values.get(key)).toBe(raw);
    fail = false;
    await persistence.save(empty());
    expect([...values.values()]).toContain(raw);
  });

  it('recovers valid native records and keeps the damaged envelope alongside subsequent saves', async () => {
    native.enabled = true;
    const fixture = new VariableStore();
    fixture.createUser({ id: 'kept', name: 'Kept', type: 'integer', initialValue: 19 });
    const raw = { version: 1, records: [...fixture.serializePersistent().records, null] };
    const values = new Map<string, unknown>([['variables', raw]]);
    native.load.mockResolvedValue({
      get: async (id: string) => values.get(id),
      set: async (id: string, value: unknown) => {
        values.set(id, value);
      },
      save: async () => {},
    });
    const { variables, persistence } = await loadVariableState();
    expect(variables.getValue('kept')).toBe(19);
    await persistence.save(variables.serializePersistent());
    expect([...values].filter(([id]) => id !== 'variables').map(([, value]) => value)).toEqual([
      raw,
    ]);
    expect(new VariableStore(values.get('variables')).getValue('kept')).toBe(19);
  });

  it('does not save over a native variables file the store could not parse', async () => {
    native.enabled = true;
    native.load.mockResolvedValue({
      get: async () => undefined,
      reload: async () => {
        throw 'Failed to deserialize store. EOF while parsing';
      },
    });
    const { variables, persistence } = await loadVariableState();
    expect(variables.snapshot().records).toEqual({});
    await expect(persistence.save(empty())).rejects.toThrow('original could not be read');
  });
});

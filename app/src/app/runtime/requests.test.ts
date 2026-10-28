import { describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import { handleRuntimeRequest } from './requests';
import type { RuntimeSession } from './session.svelte';
import type { RuntimeRequest } from './sync';

function fakeRuntime() {
  const variables = {
    createUser: vi.fn(),
    rename: vi.fn(),
    setPersistent: vi.fn(),
    remove: vi.fn(),
  };
  const runtime = {
    snapshots: writable({ revision: 1 }),
    variables,
    changePage: vi.fn(),
    changePageInDirection: vi.fn(),
    dispatchTrigger: vi.fn(async () => ({ status: 'completed' })),
    emitEvent: vi.fn(async () => {}),
    stopControl: vi.fn(async () => {}),
    setVariable: vi.fn(async () => true),
  };
  const touched = () =>
    [...Object.values(runtime), ...Object.values(variables)].some(
      (value) => vi.isMockFunction(value) && value.mock.calls.length > 0,
    );
  return { runtime: runtime as unknown as RuntimeSession, touched };
}

const request = (type: string, payload?: unknown) => ({ type, payload }) as RuntimeRequest;

describe('runtime requests from other windows', () => {
  it.each([
    ['unknown type', request('format-disk')],
    ['page change without a target', request('changePage', { reason: 'dot' })],
    ['page change to a missing page', request('changePage', { page: 'nope', reason: 'dot' })],
    ['simulation without a control', request('simulate', { trigger: 'press' })],
    [
      'simulation with an unknown trigger',
      request('simulate', { controlId: 'a', trigger: 'boom' }),
    ],
    [
      'simulation with an oversized item id',
      request('simulate', { controlId: 'a', itemId: 'x'.repeat(129) }),
    ],
    ['event with an oversized id', request('emitEvent', { eventId: 'x'.repeat(257) })],
    ['event with a non-text parameter', request('emitEvent', { eventId: 'e', parameter: 1 })],
    ['stop without a control', request('stop', {})],
    ['variable set to an object', request('setVariable', { id: 'v', value: {} })],
    ['variable of an unknown type', request('createVariable', { name: 'n', type: 'date' })],
    ['rename without a name', request('renameVariable', { id: 'v' })],
    [
      'persistence that is not a boolean',
      request('setVariablePersistence', { id: 'v', persistent: 'yes' }),
    ],
    ['delete without an id', request('deleteVariable', { id: 3 })],
  ])('rejects %s without touching the runtime', async (_name, malformed) => {
    const { runtime, touched } = fakeRuntime();

    await expect(handleRuntimeRequest(runtime, malformed)).rejects.toThrow();

    expect(touched()).toBe(false);
  });

  it('passes valid requests to the runtime owner', async () => {
    const { runtime } = fakeRuntime();

    expect(
      await handleRuntimeRequest(runtime, request('simulate', { controlId: 'a', itemId: 'i' })),
    ).toEqual({ status: 'started' });
    await handleRuntimeRequest(runtime, request('emitEvent', { eventId: 'e', parameter: 'p' }));
    await handleRuntimeRequest(runtime, request('setVariable', { id: 'v', value: 2 }));

    expect(runtime.dispatchTrigger).toHaveBeenCalledWith('a', 'i', 'press');
    expect(runtime.emitEvent).toHaveBeenCalledWith('e', 'p');
    expect(runtime.setVariable).toHaveBeenCalledWith('v', 2);
  });

  it('acknowledges a simulation while the owner continues its run', async () => {
    const { runtime } = fakeRuntime();
    vi.mocked(runtime.dispatchTrigger).mockImplementation(() => new Promise(() => {}));

    await expect(
      handleRuntimeRequest(runtime, request('simulate', { controlId: 'a' })),
    ).resolves.toEqual({ status: 'started' });
    expect(runtime.dispatchTrigger).toHaveBeenCalledWith('a', '', 'press');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { VariableStore } from '../../features/automation/variables';

const state = vi.hoisted(() => ({ load: vi.fn(), construct: vi.fn(), dispose: vi.fn() }));
vi.mock('./variable-persistence', () => ({ loadVariableState: state.load }));
vi.mock('./session.svelte', async () => {
  const { writable } = await import('svelte/store');
  const { EMPTY } = await import('./state');
  return {
    RuntimeSession: class {
      snapshots = writable(EMPTY);
      dispose = state.dispose;
      constructor() {
        state.construct();
      }
    },
  };
});

let lifecycle: typeof import('./lifecycle');
const loaded = () => ({ variables: new VariableStore() });

beforeEach(async () => {
  vi.resetModules();
  state.load.mockReset().mockImplementation(async () => loaded());
  state.construct.mockReset();
  state.dispose.mockReset().mockResolvedValue(undefined);
  lifecycle = await import('./lifecycle');
});
afterEach(async () => {
  await lifecycle.stopRuntime().catch(() => {});
});

describe('runtime lifecycle', () => {
  it('shares one session across concurrent startup requests', async () => {
    const first = lifecycle.bootRuntime();
    const second = lifecycle.bootRuntime();
    expect(first).toBe(second);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(state.construct).toHaveBeenCalledOnce();
  });

  it('allows startup to retry after loading or construction fails', async () => {
    state.load.mockRejectedValueOnce(new Error('storage failed'));
    await expect(lifecycle.bootRuntime()).rejects.toThrow('storage failed');
    state.construct.mockImplementationOnce(() => {
      throw new Error('startup failed');
    });
    await expect(lifecycle.bootRuntime()).rejects.toThrow('startup failed');
    const handle = await lifecycle.bootRuntime();
    expect(lifecycle.currentRuntime()).toBe(handle.runtime);
  });

  it('prevents a pending startup from creating an owner after shutdown was requested', async () => {
    let finish!: (value: ReturnType<typeof loaded>) => void;
    state.load.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const boot = lifecycle.bootRuntime();
    const cancelled = expect(boot).rejects.toThrow('Runtime startup was cancelled');
    await Promise.resolve();
    const stop = lifecycle.stopRuntime();
    finish(loaded());
    await stop;
    await cancelled;
    expect(state.construct).not.toHaveBeenCalled();
    expect(lifecycle.currentRuntime()).toBeUndefined();
  });

  it('makes concurrent disposal callers await the same cleanup', async () => {
    let finish!: () => void;
    state.dispose.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const handle = await lifecycle.bootRuntime();
    const first = handle.dispose();
    const second = handle.dispose();
    const stop = lifecycle.stopRuntime();
    expect(first).toBe(second);
    expect(first).toBe(stop);
    expect(lifecycle.currentRuntime()).toBeUndefined();
    finish();
    await Promise.all([first, second, stop]);
    expect(state.dispose).toHaveBeenCalledOnce();
  });

  it('waits for the old owner to stop before starting a replacement', async () => {
    let finish!: () => void;
    state.dispose.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const first = await lifecycle.bootRuntime();
    const stopping = first.dispose();
    const next = lifecycle.bootRuntime();
    await Promise.resolve();
    expect(state.construct).toHaveBeenCalledOnce();
    finish();
    await stopping;
    const replacement = await next;
    expect(replacement.runtime).not.toBe(first.runtime);
    expect(lifecycle.currentRuntime()).toBe(replacement.runtime);
  });

  it('detaches the old snapshot and permits restart even when disposal fails', async () => {
    state.dispose.mockRejectedValueOnce(new Error('cleanup failed'));
    const handle = await lifecycle.bootRuntime();
    const { runtimeView } = await import('./state');
    const before = get(runtimeView);
    await expect(handle.dispose()).rejects.toThrow('cleanup failed');
    handle.runtime.snapshots.set({ ...before, revision: 999 });
    expect(get(runtimeView)).toEqual(before);
    expect(lifecycle.currentRuntime()).toBeUndefined();
    expect((await lifecycle.bootRuntime()).runtime).not.toBe(handle.runtime);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { VariableStore } from '../../features/automation/variables';

const load = vi.hoisted(() => ({ calls: 0, next: undefined as Promise<unknown> | undefined }));
vi.mock('./variable-persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./variable-persistence')>()),
  loadVariableState: () => {
    load.calls++;
    return (
      load.next ??
      Promise.resolve({ variables: new VariableStore(), persistence: { save: async () => {} } })
    );
  },
}));

type Window = {
  services: typeof import('./services');
  session: typeof import('./session.svelte');
};
const windows: Window[] = [];

/** A fresh module graph stands in for another browser tab of the same origin. */
async function openWindow(): Promise<Window> {
  vi.resetModules();
  const window = {
    services: await import('./services'),
    session: await import('./session.svelte'),
  };
  windows.push(window);
  return window;
}

afterEach(async () => {
  load.next = undefined;
  load.calls = 0;
  await Promise.all(windows.splice(0).map((window) => window.services.stopRuntimeServices()));
});

describe('runtime ownership', () => {
  it('never creates an owner when the window stops while variables are loading', async () => {
    let finishLoad!: (value: unknown) => void;
    load.next = new Promise((resolve) => {
      finishLoad = resolve;
    });
    const tab = await openWindow();
    await tab.services.startRuntimeServices('dashboard');
    await vi.waitFor(() => expect(load.calls).toBe(1));
    await tab.services.stopRuntimeServices();
    finishLoad({ variables: new VariableStore(), persistence: { save: async () => {} } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tab.session.currentRuntime()).toBeUndefined();
  });

  it('lets one dashboard tab own the runtime and hands over only after it stopped', async () => {
    const first = await openWindow();
    await first.services.startRuntimeServices('dashboard');
    await vi.waitFor(() => expect(first.session.currentRuntime()).toBeDefined());

    const second = await openWindow();
    await second.services.startRuntimeServices('dashboard');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(second.session.currentRuntime()).toBeUndefined();

    const owner = first.session.currentRuntime()!;
    await first.services.stopRuntimeServices();
    expect(owner.isOwner).toBe(false);
    await vi.waitFor(() => expect(second.session.currentRuntime()).toBeDefined(), {
      timeout: 3000,
    });
  });
});

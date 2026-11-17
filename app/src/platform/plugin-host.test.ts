import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  label: 'main',
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  emit: vi.fn(async (_event: string, _payload?: unknown) => {}),
  emitTo: vi.fn(async (_target: string, _event: string, _payload?: unknown) => {}),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: native.label }) }));
vi.mock('@tauri-apps/api/event', () => ({
  emit: native.emit,
  emitTo: native.emitTo,
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    native.handlers.set(name, handler);
    return () => native.handlers.delete(name);
  },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const replies = () =>
  native.emit.mock.calls.filter(([event]) => event === 'plugin-reply').map(([, reply]) => reply);
const REPLY = '0b6a3c1e-5d2f-4c4b-9a7e-3f1d2c3b4a5e';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  native.handlers.clear();
});

describe('plugin call routing', () => {
  it('the owner answers only valid calls to a running service and its own methods', async () => {
    native.label = 'main';
    const { providePlugin } = await import('./plugin-host');
    providePlugin('spotify', { subscribe: (params) => ({ snapshot: params }) });
    await flush();
    expect(native.emit).toHaveBeenCalledWith('plugin://spotify/ready', null);
    const call = (payload: unknown) => native.handlers.get('plugin-call')?.({ payload });

    call({ plugin: 'spotify', method: 'subscribe', params: 1, reply: REPLY });
    for (const [plugin, method] of [
      ['discord', 'subscribe'],
      ['spotify', 'play'],
      ['spotify', 'constructor'],
      ['spotify', 'toString'],
      ['spotify', '__proto__'],
      [['spotify'], 'subscribe'],
    ]) {
      call({ plugin, method, params: null, reply: REPLY });
    }
    // No usable reply id: nothing to answer.
    for (const reply of [undefined, 5, 'not-an-id', `${REPLY}x`]) {
      call({ plugin: 'spotify', method: 'subscribe', params: null, reply });
    }
    call(null);
    await flush();
    expect(replies()).toHaveLength(7);
    expect(replies().filter((reply) => (reply as { ok: boolean }).ok)).toEqual([
      { reply: REPLY, ok: true, value: { snapshot: 1 } },
    ]);
  });

  it('a panel call resolves with its own reply only and rejects with the service error', async () => {
    native.label = 'panel';
    const { callPlugin } = await import('./plugin-host');
    const answer = (payload: unknown) => native.handlers.get('plugin-reply')?.({ payload });
    const sent = async () => {
      await flush();
      const [target, event, envelope] = native.emitTo.mock.calls.at(-1) ?? [];
      expect([target, event]).toEqual(['main', 'plugin-call']);
      return envelope as { reply: string };
    };

    const ok = callPlugin('spotify', 'subscribe', { a: 1 });
    const { reply } = await sent();
    expect(native.emitTo.mock.calls.at(-1)?.[2]).toEqual({
      plugin: 'spotify',
      method: 'subscribe',
      params: { a: 1 },
      reply,
    });
    answer({ reply: REPLY, ok: true, value: 'someone else' });
    answer({ reply, ok: true, value: 'mine' });
    await expect(ok).resolves.toBe('mine');

    const failing = callPlugin('spotify', 'play');
    answer({ reply: (await sent()).reply, ok: false, error: 'spotify has no method play' });
    await expect(failing).rejects.toThrow('spotify has no method play');
  });
});

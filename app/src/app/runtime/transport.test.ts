import { describe, expect, it, vi } from 'vitest';
import { validPageChangePayload, type SyncMessage } from './protocol';
import { RuntimeSync, type SyncAdapter } from './transport';

function pair() {
  const receivers = new Map<string, (message: SyncMessage) => void>();
  const adapter = (id: string): SyncAdapter => ({
    send: (message) => {
      for (const [other, receive] of receivers)
        if (other !== id) queueMicrotask(() => receive(structuredClone(message)));
    },
    close: () => receivers.delete(id),
  });
  const endpoint = (id: string, options: ConstructorParameters<typeof RuntimeSync>[2] = {}) => {
    const sync = new RuntimeSync(id, adapter(id), options);
    receivers.set(id, (message) => sync.receive(message));
    return sync;
  };
  return { endpoint };
}

describe('runtime sync protocol', () => {
  it('sends one request to the owner and returns a reconnect snapshot', async () => {
    const bus = pair(),
      handler = vi.fn(async (request) => ({
        type: request.type,
        activePage: 'page-two',
        variables: ['v1'],
      }));
    const owner = bus.endpoint('owner', { owner: true, onRequest: handler });
    const panel = bus.endpoint('panel');
    await expect(panel.request({ type: 'snapshot' })).resolves.toEqual({
      type: 'snapshot',
      activePage: 'page-two',
      variables: ['v1'],
    });
    expect(handler).toHaveBeenCalledOnce();
    owner.close();
    panel.close();
  });

  it('accepts only bounded, unambiguous page navigation requests', async () => {
    const bus = pair(),
      handler = vi.fn(async (request) => request.payload);
    const owner = bus.endpoint('owner', { owner: true, onRequest: handler });
    const panel = bus.endpoint('panel');
    await expect(
      panel.request({ type: 'changePage', payload: { direction: 'next', reason: 'dot' } }),
    ).resolves.toEqual({ direction: 'next', reason: 'dot' });
    for (const payload of [
      { page: 'page-2', direction: 'next', reason: 'dot' },
      { page: 'x'.repeat(129), reason: 'dot' },
      { page: 'page-2', reason: 'auto' },
      { direction: 'sideways', reason: 'swipe' },
      { direction: 'next', reason: 'dot', extra: true },
    ])
      expect(validPageChangePayload(payload)).toBe(false);
    await expect(
      panel.request({
        type: 'changePage',
        payload: { page: 'page-2', direction: 'next', reason: 'dot' } as never,
      }),
    ).rejects.toThrow('Invalid runtime request');
    expect(handler).toHaveBeenCalledTimes(1);
    owner.close();
    panel.close();
  });

  it('ignores stale snapshots and rejects a response older than its current revision', async () => {
    const bus = pair(),
      updates: unknown[] = [];
    const client = bus.endpoint('client', { onSnapshot: (value) => updates.push(value) });
    client.receive({ kind: 'snapshot', sourceId: 'owner', revision: 5, value: 'fresh' });
    client.receive({ kind: 'snapshot', sourceId: 'owner', revision: 4, value: 'stale' });
    expect(updates).toEqual(['fresh']);
    const pending = client.request({ type: 'snapshot' }, 1000);
    client.receive({
      kind: 'reply',
      sourceId: 'owner',
      destination: 'client',
      requestId: 'unmatched',
      revision: 4,
      ok: true,
    });
    expect(client.currentRevision).toBe(5);
    client.close();
    await expect(pending).rejects.toThrow('closed');
  });

  it('reports owner absence and rejects oversized or malformed requests', async () => {
    const bus = pair(),
      handler = vi.fn(async () => 'should not run');
    const owner = bus.endpoint('owner', { owner: true, onRequest: handler });
    const client = bus.endpoint('client');
    owner.close();
    await expect(client.request({ type: 'simulate' }, 5)).rejects.toThrow('unavailable');
    owner.receive({
      kind: 'request',
      sourceId: 'client',
      requestId: 'oversize',
      revision: 0,
      request: { type: 'simulate', payload: 'x'.repeat(300_000) },
    });
    expect(handler).not.toHaveBeenCalled();
    client.close();
  });
});

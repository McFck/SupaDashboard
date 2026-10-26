import { describe, expect, it } from 'vitest';
import { previewDrop, type Item } from './grid';
import { DropPreviewWorker, type DropJob, type DropReply } from './drop-worker';

class FakeWorker {
  messages: DropJob[] = [];
  terminated = false;
  failOnPost = false;
  listeners = new Map<string, (event: Event) => void>();
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener as (event: Event) => void);
  }
  postMessage(message: DropJob) {
    if (this.failOnPost) throw new Error('post failed');
    this.messages.push(structuredClone(message));
  }
  terminate() {
    this.terminated = true;
  }
  reply(job = this.messages[0]) {
    const data: DropReply = {
      ...job,
      preview: previewDrop(job.items, job.id, job.x, job.y, job.grid),
    };
    this.listeners.get('message')?.({ data } as MessageEvent);
  }
  fail() {
    this.listeners.get('error')?.({} as ErrorEvent);
  }
}

const items: Item[] = [
  { id: 'm', control: 'button', x: 0, y: 0, w: 1, h: 1 },
  { id: 'b', control: 'mixer', x: 1, y: 0, w: 1, h: 2 },
];
const input = (generation: number, x: number) => ({
  generation,
  revision: 'layout-a',
  id: 'm',
  x,
  y: 0,
  items,
  grid: { rows: 2, cols: 4 },
});

describe('drop preview worker', () => {
  it('copies proxied inputs into a cloneable scalar-only worker message', async () => {
    const workers: FakeWorker[] = [];
    const service = new DropPreviewWorker(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const proxiedItems = new Proxy(
      items.map((item) => new Proxy(item, {})),
      {},
    );
    const proxiedGrid = new Proxy({ rows: 2, cols: 4 }, {});
    const pending = service.request({ ...input(4, 3), items: proxiedItems, grid: proxiedGrid });
    const message = workers[0].messages[0];
    expect(Object.keys(message).sort()).toEqual([
      'generation',
      'grid',
      'id',
      'items',
      'requestId',
      'revision',
      'x',
      'y',
    ]);
    expect(Object.keys(message.grid).sort()).toEqual(['cols', 'rows']);
    expect(Object.keys(message.items[0]).sort()).toEqual(['control', 'h', 'id', 'w', 'x', 'y']);
    expect(() => structuredClone(message)).not.toThrow();
    workers[0].reply(message);
    await expect(pending).resolves.toMatchObject({ generation: 4, preview: { kind: 'move' } });
    service.cancel();
  });

  it('resolves construction, post and worker failures and accepts a later request', async () => {
    for (const failure of ['create', 'post', 'error'] as const) {
      let nextFailure: typeof failure | null = failure;
      const workers: FakeWorker[] = [];
      const service = new DropPreviewWorker(() => {
        if (nextFailure === 'create') {
          nextFailure = null;
          throw new Error('construction failed');
        }
        const worker = new FakeWorker();
        worker.failOnPost = nextFailure === 'post';
        workers.push(worker);
        return worker;
      });
      const failed = service.request(input(1, 1));
      if (failure === 'error') workers[0].fail();
      await expect(failed).resolves.toBeNull();
      if (failure !== 'create') expect(workers[0].terminated).toBe(true);

      nextFailure = null;
      const successful = service.request(input(2, 2));
      const worker = workers[workers.length - 1];
      worker.reply();
      await expect(successful).resolves.toMatchObject({ generation: 2, preview: { kind: 'move' } });
      service.cancel();
    }
  });

  it('terminates stale packing before starting another target and ignores its late reply', async () => {
    const workers: FakeWorker[] = [];
    const service = new DropPreviewWorker(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const stale = service.request(input(1, 1));
    const current = service.request(input(1, 2));
    expect(workers[0].terminated).toBe(true);
    await expect(stale).resolves.toBeNull();
    workers[0].reply();
    workers[1].reply();
    expect((await current)?.preview).toMatchObject({ kind: 'move', displaced: [] });
    service.cancel();
  });

  it('reuses a completed worker and caches by layout revision and target', async () => {
    const workers: FakeWorker[] = [];
    const service = new DropPreviewWorker(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const first = service.request(input(7, 1));
    workers[0].reply();
    await first;
    const cached = await service.request(input(8, 1));
    expect(workers).toHaveLength(1);
    expect(workers[0].messages).toHaveLength(1);
    expect(cached).toMatchObject({ generation: 8, preview: { kind: 'swap' } });
    service.cancel();
  });

  it('invalidates cached results after a layout revision and cancels on teardown', async () => {
    const workers: FakeWorker[] = [];
    const service = new DropPreviewWorker(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const old = service.request(input(1, 1));
    workers[0].reply();
    await old;
    const next = service.request({ ...input(2, 1), revision: 'layout-b' });
    expect(workers).toHaveLength(1);
    expect(workers[0].messages).toHaveLength(2);
    service.cancel();
    expect(workers[0].terminated).toBe(true);
    await expect(next).resolves.toBeNull();
  });
});

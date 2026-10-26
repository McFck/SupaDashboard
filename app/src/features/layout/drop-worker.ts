import { previewDrop, type DropPreview, type Grid, type Item } from './grid';

export type DropJob = { requestId: number; generation: number; revision: string; id: string; x: number; y: number; items: Item[]; grid: Grid };
export type DropReply = Omit<DropJob, 'items' | 'grid'> & { preview: DropPreview };
type WorkerPort = Pick<Worker, 'addEventListener' | 'postMessage' | 'terminate'>;
type WorkerFactory = () => WorkerPort;

type Pending = { key: string; requestId: number; generation: number; promise: Promise<DropReply | null>; resolve(value: DropReply | null): void };

const cacheKey = (job: Pick<DropJob, 'revision' | 'id' | 'x' | 'y'>) => `${job.revision}/${job.id}/${job.x},${job.y}`;

const tags = (job: Omit<DropJob, 'items' | 'grid' | 'requestId'>, requestId: number) => ({
  requestId, generation: job.generation, revision: job.revision, id: job.id, x: job.x, y: job.y,
});

const cloneJob = (input: Omit<DropJob, 'requestId'>, requestId: number): DropJob => ({
  ...tags(input, requestId),
  items: input.items.map(({ id, control, x, y, w, h }) => ({ id, control, x, y, w, h })),
  grid: { rows: input.grid.rows, cols: input.grid.cols },
});

/** One cancellable module worker and completed results per immutable layout revision. */
export class DropPreviewWorker {
  private worker: WorkerPort | null = null;
  private pending: Pending | null = null;
  private cache = new Map<string, DropPreview>();
  private revision = '';
  private requestId = 0;

  constructor(private readonly createWorker: WorkerFactory = () =>
    new Worker(new URL('./drop-worker.ts', import.meta.url), { type: 'module' })) {}

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    this.worker = worker;
    worker.addEventListener('message', event => {
      if (this.worker !== worker) return;
      const reply = (event as MessageEvent<DropReply>).data;
      const pending = this.pending;
      if (!pending || reply.requestId !== pending.requestId || reply.generation !== pending.generation ||
        reply.revision !== this.revision) return;
      this.cache.set(pending.key, reply.preview);
      this.pending = null;
      pending.resolve(reply);
    });
    worker.addEventListener('error', () => {
      if (this.worker !== worker) return;
      const pending = this.pending;
      this.worker?.terminate();
      this.worker = null;
      this.pending = null;
      pending?.resolve(null);
    });
    return worker;
  }

  request(input: Omit<DropJob, 'requestId'>): Promise<DropReply | null> {
    if (input.revision !== this.revision) {
      this.cancelPending();
      this.cache.clear();
      this.revision = input.revision;
    }
    const key = cacheKey(input);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve({ ...input, requestId: this.requestId, preview: cached });
    if (this.pending?.key === key && this.pending.generation === input.generation) return this.pending.promise;
    this.cancelPending();
    const requestId = ++this.requestId;
    let resolve!: (value: DropReply | null) => void;
    const promise = new Promise<DropReply | null>(done => { resolve = done; });
    this.pending = { key, requestId, generation: input.generation, promise, resolve };
    try {
      this.ensureWorker().postMessage(cloneJob(input, requestId));
    } catch {
      const failed = this.pending;
      this.worker?.terminate();
      this.worker = null;
      this.pending = null;
      failed?.resolve(null);
    }
    return promise;
  }

  cancelPending() {
    const pending = this.pending;
    if (!pending) return;
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
    pending.resolve(null);
  }

  cancel() {
    this.cancelPending();
    this.worker?.terminate();
    this.worker = null;
    this.cache.clear();
    this.revision = '';
  }
}

// The same module is loaded as a dedicated worker; the window-side controller above is inert there.
if (typeof self !== 'undefined' && typeof document === 'undefined' && 'postMessage' in self) {
  const scope = self as unknown as {
    addEventListener(type: 'message', listener: (event: MessageEvent<DropJob>) => void): void;
    postMessage(message: DropReply): void;
  };
  scope.addEventListener('message', event => {
    const { requestId, generation, revision, id, x, y, items, grid } = event.data;
    scope.postMessage({ requestId, generation, revision, id, x, y, preview: previewDrop(items, id, x, y, grid) });
  });
}

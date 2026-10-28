import type { VolumePatch } from './volume-model';

export type VolumeWriteHost = {
  send(target: string, deviceId: string, patch: VolumePatch): Promise<unknown>;
  /** Applies the snapshot returned with a write; it may cancel this or other queues. */
  ingest(snapshot: unknown): void;
  changed(): void;
};

type Waiter = { resolve: () => void; reject: (error: Error) => void };
type Job = { patch: VolumePatch; generation: number; deviceId: string; waiters: Waiter[] };
type Queue = {
  pending: Job | null;
  inFlight: Job | null;
  timer: ReturnType<typeof setTimeout> | null;
  lastSentAt: number;
};

/** At most one native write per target in this many milliseconds. */
const SEND_INTERVAL = 50;

function validResult(result: unknown): result is { applied: boolean; snapshot: unknown } {
  return (
    !!result &&
    typeof result === 'object' &&
    typeof (result as { applied?: unknown }).applied === 'boolean' &&
    'snapshot' in result
  );
}

/**
 * Owns every pending native volume write: one rate-limited queue per target that coalesces rapid writes, and the
 * optimistic values shown until the native side confirms them. A queue that is cancelled is removed from the map,
 * so an in-flight write that finds a different (or no) queue for its target is stale and is ignored.
 */
export class VolumeWriteQueue {
  private readonly queues = new Map<string, Queue>();
  private readonly optimistic = new Map<string, { patch: VolumePatch; generation: number }>();
  private generation = 0;

  constructor(private readonly host: VolumeWriteHost) {}

  /** Optimistic patches in the order they were written. */
  optimisticPatches(): [target: string, patch: VolumePatch][] {
    return [...this.optimistic.entries()]
      .sort((a, b) => a[1].generation - b[1].generation)
      .map(([target, update]) => [target, update.patch]);
  }

  enqueue(target: string, deviceId: string, patch: VolumePatch): Promise<void> {
    let queue = this.queues.get(target);
    if (!queue) {
      queue = { pending: null, inFlight: null, timer: null, lastSentAt: Number.NEGATIVE_INFINITY };
      this.queues.set(target, queue);
    }
    const generation = ++this.generation;
    let waiter!: Waiter;
    const promise = new Promise<void>((resolve, reject) => {
      waiter = { resolve, reject };
    });
    queue.pending = {
      patch: { ...queue.pending?.patch, ...patch },
      generation,
      deviceId,
      waiters: [...(queue.pending?.waiters ?? []), waiter],
    };
    this.optimistic.set(target, {
      patch: { ...this.optimistic.get(target)?.patch, ...patch },
      generation,
    });
    this.host.changed();
    this.schedule(target, queue);
    return promise;
  }

  /** Rejects the writes of every target `stale` accepts; the caller publishes. */
  cancelWhere(stale: (target: string) => boolean, reason: string) {
    for (const [target, queue] of [...this.queues]) {
      if (stale(target)) {
        this.cancel(target, queue, reason);
      }
    }
  }

  cancelAll(reason: string) {
    this.cancelWhere(() => true, reason);
    this.optimistic.clear();
    this.host.changed();
  }

  private cancel(target: string, queue: Queue, reason: string) {
    if (queue.timer) {
      clearTimeout(queue.timer);
    }
    queue.timer = null;
    const error = new Error(reason);
    for (const job of [queue.pending, queue.inFlight]) {
      for (const waiter of job?.waiters ?? []) {
        waiter.reject(error);
      }
    }
    queue.pending = null;
    queue.inFlight = null;
    this.queues.delete(target);
    this.optimistic.delete(target);
  }

  private schedule(target: string, queue: Queue) {
    if (queue.inFlight || !queue.pending) {
      return;
    }
    const delay = Math.max(0, SEND_INTERVAL - (Date.now() - queue.lastSentAt));
    if (delay === 0) {
      void this.flush(target, queue);
    } else if (!queue.timer) {
      queue.timer = setTimeout(() => {
        queue.timer = null;
        void this.flush(target, queue);
      }, delay);
    }
  }

  /** Clears the optimistic value only if no newer write replaced it. */
  private settleOptimistic(target: string, generation: number) {
    if (this.optimistic.get(target)?.generation !== generation) {
      return false;
    }
    this.optimistic.delete(target);
    return true;
  }

  private async flush(target: string, queue: Queue) {
    const job = queue.pending;
    if (queue.inFlight || !job || this.queues.get(target) !== queue) {
      return;
    }
    if (queue.timer) {
      clearTimeout(queue.timer);
    }
    queue.timer = null;
    queue.pending = null;
    queue.inFlight = job;
    queue.lastSentAt = Date.now();
    try {
      const result = await this.host.send(target, job.deviceId, job.patch);
      if (this.queues.get(target) !== queue) {
        return;
      }
      if (!validResult(result)) {
        throw new Error('Core Audio returned an invalid update result');
      }
      this.host.ingest(result.snapshot);
      if (this.queues.get(target) !== queue) {
        return;
      }
      if (!result.applied) {
        this.settleOptimistic(target, job.generation);
        this.host.changed();
        const error = new Error('Volume target is no longer available');
        for (const waiter of job.waiters) {
          waiter.reject(error);
        }
        return;
      }
      if (this.settleOptimistic(target, job.generation)) {
        this.host.changed();
      }
      for (const waiter of job.waiters) {
        waiter.resolve();
      }
    } catch (error) {
      if (this.queues.get(target) !== queue) {
        return;
      }
      if (this.settleOptimistic(target, job.generation)) {
        this.host.changed();
      }
      const reason = error instanceof Error ? error : new Error(String(error));
      for (const waiter of job.waiters) {
        waiter.reject(reason);
      }
    } finally {
      if (this.queues.get(target) === queue) {
        queue.inFlight = null;
        this.schedule(target, queue);
      }
    }
  }
}

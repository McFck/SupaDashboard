import type { Trigger } from './scenario';
import type { RunResult, ScenarioFailure, TriggerPacket } from './scenario-runner';

type Job = {
  packet: TriggerPacket;
  fingerprint: string;
  resolve(result: RunResult): void;
  controller?: AbortController;
  done?: { promise: Promise<RunResult>; resolve(result: RunResult): void };
};
type Lane = { key: string; controlId: string; queue: Job[]; current?: Job; draining: boolean };
const cancelled = (): RunResult => ({ status: 'cancelled' });

export class ExecutionEngine {
  private readonly lanes = new Map<string, Lane>();
  private readonly busyCounts = new Map<string, number>();
  private readonly queueFullReported = new Set<string>();
  private disposed = false;

  constructor(
    private readonly host: {
      execute(packet: TriggerPacket, signal: AbortSignal): Promise<RunResult>;
      getFingerprint(controlId: string): string | undefined;
      onBusyChange(): void;
      onFailure?(failure: ScenarioFailure): void;
      onQueueFull?(controlId: string, trigger: Trigger | 'event'): void;
    },
  ) {}

  busy(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.busyCounts);
  }

  dispatch(packet: TriggerPacket): Promise<RunResult> {
    if (this.disposed) {
      return Promise.resolve({ status: 'rejected' });
    }
    const fingerprint = this.host.getFingerprint(packet.controlId);
    if (fingerprint === undefined) {
      return Promise.resolve({ status: 'rejected' });
    }
    const laneKey = `${packet.controlId}\u0000${packet.trigger === 'event' ? (packet.listenerId ?? 'event') : packet.trigger}`;
    let lane = this.lanes.get(laneKey);
    if (!lane) {
      lane = { key: laneKey, controlId: packet.controlId, queue: [], draining: false };
      this.lanes.set(laneKey, lane);
    }
    if (lane.queue.length >= 32) {
      if (!this.queueFullReported.has(laneKey)) {
        this.queueFullReported.add(laneKey);
        try {
          this.host.onQueueFull?.(packet.controlId, packet.trigger);
        } catch {
          /* status sink must not reject dispatch */
        }
      }
      return Promise.resolve({ status: 'rejected' });
    }
    return new Promise((resolve) => {
      lane.queue.push({
        packet: structuredClone(packet),
        fingerprint,
        resolve,
      });
      void this.drain(lane);
    });
  }

  async stopControl(controlId: string) {
    const stopped: Promise<RunResult>[] = [];
    for (const lane of this.lanes.values()) {
      if (lane.controlId !== controlId) {
        continue;
      }
      for (const pending of lane.queue.splice(0)) {
        pending.resolve(cancelled());
      }
      if (lane.current) {
        lane.current.controller?.abort();
        if (lane.current.done) {
          stopped.push(lane.current.done.promise);
        }
      }
    }
    await Promise.all(stopped);
  }

  reconcile(current: ReadonlyMap<string, string>) {
    for (const lane of this.lanes.values()) {
      const expected = current.get(lane.controlId);
      if (expected === undefined || lane.current?.fingerprint !== expected) {
        lane.current?.controller?.abort();
      }
      if (expected === undefined) {
        for (const pending of lane.queue.splice(0)) {
          pending.resolve(cancelled());
        }
      } else {
        const keep = lane.queue.filter((job) => job.fingerprint === expected);
        for (const job of lane.queue) {
          if (!keep.includes(job)) {
            job.resolve(cancelled());
          }
        }
        lane.queue = keep;
      }
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const lane of this.lanes.values()) {
      lane.current?.controller?.abort();
      for (const pending of lane.queue.splice(0)) {
        pending.resolve(cancelled());
      }
    }
  }

  private async drain(lane: Lane) {
    if (lane.draining) {
      return;
    }
    lane.draining = true;
    try {
      while (lane.queue.length && !this.disposed) {
        const job = lane.queue.shift()!;
        if (this.host.getFingerprint(job.packet.controlId) !== job.fingerprint) {
          job.resolve(cancelled());
          continue;
        }
        const controller = new AbortController();
        job.controller = controller;
        lane.current = job;
        let complete!: (result: RunResult) => void;
        const done = new Promise<RunResult>((resolve) => {
          complete = resolve;
        });
        job.done = { promise: done, resolve: complete };
        this.adjustBusy(job.packet.controlId, 1);
        let result: RunResult;
        try {
          result = await this.host.execute(job.packet, controller.signal);
        } catch {
          result = { status: 'failed' };
        }
        if (result.status === 'failed' && result.failure) {
          try {
            this.host.onFailure?.(result.failure);
          } catch {
            /* a toast sink cannot block a lane */
          }
        }
        lane.current = undefined;
        this.adjustBusy(job.packet.controlId, -1);
        job.resolve(result);
        job.done.resolve(result);
        if (!lane.queue.length) {
          this.queueFullReported.delete(lane.key);
        }
      }
    } finally {
      lane.draining = false;
      if (!lane.current && !lane.queue.length) {
        this.lanes.delete(lane.key);
      }
    }
  }

  private adjustBusy(controlId: string, delta: number) {
    const count = Math.max(0, (this.busyCounts.get(controlId) ?? 0) + delta);
    if (count) {
      this.busyCounts.set(controlId, count);
    } else {
      this.busyCounts.delete(controlId);
    }
    this.host.onBusyChange();
  }
}

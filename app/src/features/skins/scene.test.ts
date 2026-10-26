import { describe, expect, it, vi } from 'vitest';
import { mapScenePoint, SceneScheduler } from './scene';

function clock() {
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    callbacks,
    request: vi.fn((callback: FrameRequestCallback) => {
      callbacks.set(++id, callback);
      return id;
    }),
    cancel: vi.fn((value: number) => {
      callbacks.delete(value);
    }),
    frame(time: number) {
      const next = callbacks.keys().next();
      if (next.done) return;
      const callback = callbacks.get(next.value)!;
      callbacks.delete(next.value);
      callback(time);
    },
  };
}

describe('scene scheduling', () => {
  it('maps pointer positions through the scaled canvas and rejects outside points', () => {
    const rect = { left: 20, top: 40, width: 960, height: 240 };
    expect(mapScenePoint(500, 160, rect, 1920, 480)).toEqual({ x: 960, y: 240 });
    expect(mapScenePoint(19, 40, rect, 1920, 480)).toBeNull();
    expect(mapScenePoint(980, 280, rect, 1920, 480)).toBeNull();
    expect(mapScenePoint(20, 40, { ...rect, width: 0 }, 1920, 480)).toBeNull();
  });

  it('coalesces invalidations and stops static scenes after one frame', () => {
    const raf = clock(),
      draw = vi.fn(() => false);
    const scheduler = new SceneScheduler(draw, 'live', raf.request, raf.cancel);
    scheduler.setActive(true);
    scheduler.invalidate();
    scheduler.invalidate();
    expect(raf.callbacks.size).toBe(1);
    raf.frame(100);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledWith(0);
    expect(raf.callbacks.size).toBe(0);
  });

  it('runs requested animation with one outstanding frame and restarts its time origin after hiding', () => {
    const raf = clock(),
      times: number[] = [];
    const scheduler = new SceneScheduler(
      (time) => {
        times.push(time);
        return times.length === 1 || times.length === 3 || times.length === 4;
      },
      'live',
      raf.request,
      raf.cancel,
    );
    scheduler.setActive(true);
    raf.frame(50);
    raf.frame(66);
    expect(times).toEqual([0, 16]);
    expect(raf.callbacks.size).toBe(0);
    scheduler.invalidate();
    raf.frame(80);
    scheduler.setActive(false);
    scheduler.setActive(true);
    raf.frame(500);
    expect(times.at(-1)).toBe(0);
    expect(raf.callbacks.size).toBe(1);
    raf.frame(516);
    expect(times.at(-1)).toBe(16);
    scheduler.dispose();
    expect(raf.callbacks.size).toBe(0);
  });

  it('renders frozen updates at time zero and ignores animation requests', () => {
    const raf = clock(),
      draw = vi.fn(() => true),
      dispose = vi.fn();
    const scheduler = new SceneScheduler(draw, 'frozen', raf.request, raf.cancel, dispose);
    scheduler.setActive(true);
    raf.frame(1000);
    expect(draw).toHaveBeenCalledWith(0);
    expect(raf.callbacks.size).toBe(0);
    scheduler.invalidate();
    raf.frame(2000);
    expect(draw).toHaveBeenCalledTimes(2);
    scheduler.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('cancels hidden pending work and paints one dirty frame after resuming', () => {
    const raf = clock(),
      draw = vi.fn(() => false);
    const scheduler = new SceneScheduler(draw, 'live', raf.request, raf.cancel);
    scheduler.setActive(true);
    scheduler.setActive(false);
    expect(raf.callbacks.size).toBe(0);
    scheduler.setActive(true);
    raf.frame(800);
    expect(draw).toHaveBeenCalledTimes(1);
  });
});

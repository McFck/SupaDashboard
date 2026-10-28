import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkinInputRecognizer } from './input';
import type { SceneInput, SceneRect } from './scene-contracts';

const rect: SceneRect = { left: 20, top: 40, width: 1000, height: 480 };
const point = (
  kind: SceneInput['kind'],
  time: number,
  x = 100,
  y = 100,
  pointerId = 1,
): SceneInput => ({
  kind,
  time,
  x,
  y,
  pointerId,
  pointerType: 'mouse',
  button: 0,
  screenX: x + rect.left,
  screenY: y + rect.top,
});

afterEach(() => vi.useRealTimers());

describe('skin quick-action input', () => {
  it('consumes three close, timely taps once and leaves the scene untouched', () => {
    vi.useFakeTimers();
    const open = vi.fn(),
      scene: SceneInput[] = [];
    const recognizer = new SkinInputRecognizer(open);
    for (const [index, x] of [100, 112, 124].entries()) {
      const time = index * 300;
      expect(recognizer.handle(point('down', time, x), rect, (event) => scene.push(event))).toBe(
        true,
      );
      expect(
        recognizer.handle(point('up', time + 100, x), rect, (event) => scene.push(event)),
      ).toBe(true);
    }
    expect(open).toHaveBeenCalledOnce();
    expect(scene).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('delivers an incomplete tap sequence to the scene once when its window expires', () => {
    vi.useFakeTimers();
    const open = vi.fn(),
      scene: SceneInput[] = [];
    const recognizer = new SkinInputRecognizer(open);
    const down = point('down', 0),
      up = point('up', 80);
    recognizer.handle(down, rect, (event) => scene.push(event));
    recognizer.handle(up, rect, (event) => scene.push(event));
    expect(scene).toEqual([]);
    vi.advanceTimersByTime(350);
    expect(open).not.toHaveBeenCalled();
    expect(scene).toEqual([down, up]);
  });

  it('flushes a pending tap and forwards a scene drag after the movement slop', () => {
    vi.useFakeTimers();
    const open = vi.fn(),
      scene: SceneInput[] = [];
    const recognizer = new SkinInputRecognizer(open);
    const tapDown = point('down', 0),
      tapUp = point('up', 70);
    recognizer.handle(tapDown, rect, (event) => scene.push(event));
    recognizer.handle(tapUp, rect, (event) => scene.push(event));
    const dragDown = point('down', 100, 200),
      move = point('move', 120, 210);
    recognizer.handle(dragDown, rect, (event) => scene.push(event));
    expect(recognizer.handle(move, rect, (event) => scene.push(event))).toBe(false);
    scene.push(move);
    const up = point('up', 150, 210);
    expect(recognizer.handle(up, rect, (event) => scene.push(event))).toBe(false);
    scene.push(up);
    expect(open).not.toHaveBeenCalled();
    expect(scene).toEqual([tapDown, tapUp, dragDown, move, up]);
  });

  it('opens only after the configured corner hold and passes an early release to the scene', () => {
    vi.useFakeTimers();
    const open = vi.fn(),
      scene: SceneInput[] = [];
    const recognizer = new SkinInputRecognizer(open);
    recognizer.setOptions('cornerHold', 'bottomRight');
    const earlyDown = point('down', 0, 990, 470, 1),
      earlyUp = point('up', 100, 990, 470, 1);
    expect(recognizer.handle(earlyDown, rect, (event) => scene.push(event))).toBe(true);
    recognizer.handle(earlyUp, rect, (event) => scene.push(event));
    expect(scene).toEqual([earlyDown, earlyUp]);

    const holdDown = point('down', 200, 990, 470, 2),
      holdUp = point('up', 800, 990, 470, 2);
    expect(recognizer.handle(holdDown, rect, (event) => scene.push(event))).toBe(true);
    vi.advanceTimersByTime(549);
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledOnce();
    expect(recognizer.handle(holdUp, rect, (event) => scene.push(event))).toBe(true);
    expect(scene).toEqual([earlyDown, earlyUp]);
  });

  it('resets and flushes a partial sequence on reconfiguration', () => {
    vi.useFakeTimers();
    const open = vi.fn(),
      scene: SceneInput[] = [];
    const recognizer = new SkinInputRecognizer(open);
    const down = point('down', 0),
      up = point('up', 80);
    recognizer.handle(down, rect, (event) => scene.push(event));
    recognizer.handle(up, rect, (event) => scene.push(event));
    recognizer.setOptions('off', 'bottomRight');
    expect(scene).toEqual([down, up]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

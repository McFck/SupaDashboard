import { afterEach, describe, expect, it, vi } from 'vitest';
import { PressMachine, type Captures } from './press';

const pairable: Captures = { doubleTap: 'packet' };

describe('press machine', () => {
  afterEach(() => vi.useRealTimers());

  it('delivers a tap waiting for its pair before a moving press takes over', () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const press = new PressMachine<{ x: number; y: number; captures: Captures; name: string }>({
      trigger: (trigger) => order.push(trigger),
      tap: ({ name }) => order.push(name),
    });
    press.start(pairable);
    press.end({ x: 10, y: 10, captures: pairable, name: 'tap' });
    press.start(pairable);
    press.move();
    order.push('drag');
    expect(press.end({ x: 60, y: 10, captures: pairable, name: 'late' })).toBe('moved');
    vi.advanceTimersByTime(1000);
    expect(order).toEqual(['tap', 'drag']);
  });
});

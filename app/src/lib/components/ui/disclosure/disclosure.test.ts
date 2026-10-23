import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionLifecycle } from './motion';

describe('Disclosure motion lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('cancels a stale close on reopen and clears pending work on destroy', async () => {
    vi.useFakeTimers();
    const canceled = vi.fn();
    const node = { animate: () => ({ cancel: canceled }) } as unknown as HTMLElement;
    const motion = new MotionLifecycle();
    let removed = false;

    const close = motion.begin();
    motion.animate(node, [], { duration: 100 });
    motion.after(close, 100, () => { removed = true; });
    await vi.advanceTimersByTimeAsync(50);

    const reopen = motion.begin();
    motion.animate(node, [], { duration: 180 });
    expect(motion.current(close)).toBe(false);
    expect(canceled).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(removed).toBe(false);
    expect(motion.current(reopen)).toBe(true);

    motion.after(reopen, 100, () => { removed = true; });
    motion.dispose();
    await vi.runOnlyPendingTimersAsync();
    expect(removed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(canceled).toHaveBeenCalledTimes(2);
  });
});

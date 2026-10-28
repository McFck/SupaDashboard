import { describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ publish: (_event: unknown) => {} }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: async () => true }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: async (_name: string, handler: (event: { payload: unknown }) => void) => {
      native.publish = (payload) => handler({ payload });
      return () => {};
    },
  }),
}));
import {
  WEB_FRAME_TIMEOUT_MS,
  consumeEligibleTime,
  initialWebFrameState,
  reduceWebFrameDomLoad,
  reduceWebFrameState,
  subscribeWebFrameEvents,
} from './web-frame-status';

describe('web frame readiness', () => {
  it('rejects malformed phase payloads before any frame subscriber can consume them', async () => {
    const publish = (event: unknown) => native.publish(event);
    const received: unknown[] = [];
    const subscription = await subscribeWebFrameEvents((event) => received.push(event));
    try {
      expect(subscription.nativeStatus).toBe(true);
      const base = { frameKey: 'content:a', navigationId: 10 };
      const completed = { ...base, phase: 'completed', success: true };
      for (const event of [
        null,
        [],
        {},
        { ...completed, frameKey: '' },
        { ...completed, frameKey: 'content:' },
        { ...completed, frameKey: 'content:a b' },
        { ...completed, frameKey: 'content:a\n' },
        { ...completed, frameKey: 'foreign:a' },
        { ...completed, navigationId: -1 },
        { ...completed, navigationId: 1.5 },
        { ...completed, navigationId: Infinity },
        { ...completed, navigationId: Number.MAX_SAFE_INTEGER + 1 },
        { ...completed, navigationId: '10' },
        { ...completed, phase: 'ready' },
        { ...completed, success: undefined },
        { ...completed, success: 'false' },
        { ...completed, success: 1 },
        { ...completed, success: false, error: {} },
        { ...completed, error: 'contradictory' },
        { ...base, phase: 'starting', success: false },
        { ...base, phase: 'destroyed', error: 'unexpected' },
      ]) {
        publish(event);
      }
      expect(received).toEqual([]);
      const valid = [
        { ...base, phase: 'starting' },
        completed,
        { ...base, phase: 'completed', success: false, error: 'blocked-navigation' },
        { ...base, phase: 'completed', success: false },
        { ...base, navigationId: 0, phase: 'destroyed' },
      ];
      valid.forEach(publish);
      expect(received).toEqual(valid);
    } finally {
      subscription.dispose();
      await Promise.resolve();
    }
  });

  it('correlates starts and completions by generated frame name and navigation id', () => {
    const state = initialWebFrameState('content:a');
    const started = reduceWebFrameState(state, {
      frameKey: 'content:a',
      navigationId: 10,
      phase: 'starting',
    });
    expect(
      reduceWebFrameState(started, {
        frameKey: 'content:b',
        navigationId: 10,
        phase: 'completed',
        success: true,
      }),
    ).toBe(started);
    expect(
      reduceWebFrameState(started, {
        frameKey: 'content:a',
        navigationId: 9,
        phase: 'completed',
        success: true,
      }),
    ).toBe(started);
    expect(
      reduceWebFrameState(started, {
        frameKey: 'content:a',
        navigationId: 10,
        phase: 'completed',
        success: false,
      }),
    ).toMatchObject({ status: 'unavailable' });
    const next = reduceWebFrameState(started, {
      frameKey: 'content:a',
      navigationId: 11,
      phase: 'starting',
    });
    expect(
      reduceWebFrameState(next, {
        frameKey: 'content:a',
        navigationId: 10,
        phase: 'completed',
        success: true,
      }),
    ).toBe(next);
    expect(
      reduceWebFrameState(next, {
        frameKey: 'content:a',
        navigationId: 11,
        phase: 'completed',
        success: true,
      }),
    ).toMatchObject({ status: 'ready' });
  });

  it('treats DOM load as preview-only when native status is installed and records native failure', () => {
    const state = initialWebFrameState('content:a');
    expect(reduceWebFrameDomLoad(state, true)).toMatchObject({
      status: 'loading',
      domLoaded: true,
    });
    expect(reduceWebFrameDomLoad(state, false)).toMatchObject({ status: 'ready', domLoaded: true });
    expect(
      reduceWebFrameState(state, { frameKey: 'content:a', navigationId: 2, phase: 'destroyed' }),
    ).toMatchObject({ status: 'unavailable' });
  });

  it('consumes only elapsed visible time', () => {
    const afterVisibleFiveSeconds = consumeEligibleTime(WEB_FRAME_TIMEOUT_MS, 5_000);
    expect(afterVisibleFiveSeconds).toBe(10_000);
    expect(consumeEligibleTime(afterVisibleFiveSeconds, 0)).toBe(10_000);
    expect(consumeEligibleTime(2_000, 5_000)).toBe(0);
    expect(consumeEligibleTime(1_000, -1)).toBe(1_000);
  });
});

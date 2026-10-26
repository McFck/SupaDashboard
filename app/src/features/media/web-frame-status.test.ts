import { describe, expect, it } from 'vitest';
import {
  WEB_FRAME_TIMEOUT_MS,
  consumeEligibleTime,
  initialWebFrameState,
  reduceWebFrameDomLoad,
  reduceWebFrameState,
} from './web-frame-status';

describe('web frame readiness', () => {
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

  it('uses a 15 second eligible-time timeout and consumes only elapsed visible time', () => {
    expect(WEB_FRAME_TIMEOUT_MS).toBe(15_000);
    const afterVisibleFiveSeconds = consumeEligibleTime(WEB_FRAME_TIMEOUT_MS, 5_000);
    expect(afterVisibleFiveSeconds).toBe(10_000);
    expect(consumeEligibleTime(afterVisibleFiveSeconds, 0)).toBe(10_000);
    expect(consumeEligibleTime(2_000, 5_000)).toBe(0);
    expect(consumeEligibleTime(1_000, -1)).toBe(1_000);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { availableGestures, moveVariant, removeVariant, type ControlConfig } from './model';
import { buttonIconSize, mixerLayout, pressRippleGeometry, sliderOrientation } from './geometry';
import {
  beginPull,
  classify,
  pullBindingsFor,
  pullHandoffProgress,
  shouldAnimateSliderFill,
  updatePull,
} from './interaction';
import { springDuration, springProgress, SPRING_SAMPLES } from '$lib/spring';
import {
  projectMoveOrigin,
  resizeCornerGeometry,
  resizeFromCornerHysteretic,
  resizePreview,
  type ResizeCorner,
} from '../layout/drag-geometry';
import { tapSequence } from './gestures';
import { actions, install, runAction } from '../plugins/registry';
import { corePlugin } from '../../plugins/core';

const prev: ControlConfig = {
  id: 'prev',
  name: 'Previous',
  type: 'button',
  variants: [
    { id: 'all-media', label: 'All media' },
    { id: 'spotify', label: 'Spotify' },
  ],
  scenario: {
    triggers: {
      swipeDown: {
        steps: [
          {
            id: 'next',
            kind: 'action',
            action: { id: 'button.variant', args: { target: 'self', variant: 'next' } },
          },
        ],
      },
      swipeUp: {
        steps: [
          {
            id: 'prev',
            kind: 'action',
            action: { id: 'button.variant', args: { target: 'self', variant: 'prev' } },
          },
        ],
      },
    },
    events: [],
  },
};

describe('gestures', () => {
  it('classifies taps, long presses and swipes', () => {
    expect(classify(3, 5, 120)).toBe('tap');
    expect(classify(3, 5, 800)).toBe('longPress');
    expect(classify(4, 90, 200)).toBe('swipeDown');
    expect(classify(-80, 20, 200)).toBe('swipeLeft');
    expect(classify(3, 5, 100, 250)).toBe('doubleTap');
    expect(classify(3, 5, 100, 301)).toBe('tap');
    expect(classify(3, 5, 800, 250)).toBe('longPress');
    expect(classify(-80, 20, 100, 250)).toBe('swipeLeft');
  });

  it('offers double taps and reserves the slider value axis', () => {
    expect(availableGestures('button', 1, 1)).toContain('doubleTap');
    expect(availableGestures('media', 2, 2)).toContain('swipeLeft');
    expect(availableGestures('web', 3, 2)).toContain('longPress');
    expect(availableGestures('slider', 1, 3)).toEqual([
      'swipeLeft',
      'swipeRight',
      'longPress',
      'doubleTap',
    ]);
    expect(availableGestures('slider', 3, 1)).toEqual([
      'swipeDown',
      'swipeUp',
      'longPress',
      'doubleTap',
    ]);
  });
});

describe('spring motion', () => {
  it('starts at zero, settles near one, stays finite and has less than two percent overshoot', () => {
    expect(springProgress(0)).toBe(0);
    expect(Math.abs(1 - springProgress(0.52))).toBeLessThan(0.02);
    const samples = Array.from({ length: 100 }, (_, i) => springProgress((0.52 * i) / 99));
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(Math.max(...samples)).toBeLessThan(1.02);
    expect(SPRING_SAMPLES[0].progress).toBe(0);
    expect(SPRING_SAMPLES.at(-1)).toEqual({ offset: 1, progress: 1 });
    expect(SPRING_SAMPLES).toHaveLength(32);
    expect(springDuration(0)).toBe(360);
    expect(springDuration(400)).toBe(420);
    expect(springDuration(1000)).toBe(520);
    expect(springDuration(Number.NaN)).toBe(360);
  });
});

describe('tap sequences', () => {
  afterEach(() => vi.useRealTimers());
  it('keeps unbound taps immediate and emits only the bound double-tap action', () => {
    vi.useFakeTimers();
    const emit = vi.fn(),
      taps = tapSequence(emit);
    taps.send('tap', 20, 20);
    expect(emit).toHaveBeenCalledExactlyOnceWith('tap', 20, 20);
    emit.mockClear();
    taps.send('tap', 20, 20, true);
    vi.advanceTimersByTime(180);
    taps.send('tap', 23, 22, true);
    vi.advanceTimersByTime(400);
    expect(emit).toHaveBeenCalledExactlyOnceWith('doubleTap', 23, 22);
  });
  it('keeps distant taps separate and flushes single taps after the window', () => {
    vi.useFakeTimers();
    const emit = vi.fn(),
      taps = tapSequence(emit);
    taps.send('tap', 20, 20, true);
    vi.advanceTimersByTime(100);
    taps.send('tap', 100, 20, true);
    vi.advanceTimersByTime(301);
    expect(emit.mock.calls).toEqual([
      ['tap', 20, 20],
      ['tap', 100, 20],
    ]);
  });
  it('cancels pending taps on teardown and keeps long presses independent', () => {
    vi.useFakeTimers();
    const emit = vi.fn(),
      taps = tapSequence(emit);
    taps.send('tap', 0, 0, true);
    taps.cancel();
    vi.advanceTimersByTime(400);
    expect(emit).not.toHaveBeenCalled();
    taps.send('longPress', 0, 0, true);
    expect(emit).toHaveBeenCalledExactlyOnceWith('longPress', 0, 0);
  });
});

describe('mixer layout', () => {
  it('chooses the larger minimum pill dimension using pixels and channel count', () => {
    expect(mixerLayout(490, 238, 6)).toBe('vertical');
    expect(mixerLayout(238, 490, 6)).toBe('horizontal');
    expect(mixerLayout(490, 238, 2)).toBe('vertical');
    expect(mixerLayout(490, 112, 1)).toBe('horizontal');
    expect(mixerLayout(112, 490, 1)).toBe('vertical');
  });
  it('accounts for actual card padding and channel gaps, including no channels', () => {
    expect(mixerLayout(300, 250, 3, 0, 10)).toBe('vertical');
    expect(mixerLayout(250, 300, 3, 0, 10)).toBe('horizontal');
    expect(mixerLayout(0, 0, 0)).toBe('vertical');
    expect(mixerLayout(100, 60, 12)).toBe('horizontal');
  });
});

describe('corner resizing', () => {
  const rect = { x: 3, y: 3, w: 3, h: 3 };
  it('keeps live previews continuous below the cell snap threshold, with opposite-corner anchoring', () => {
    const preview = resizePreview(rect, 'se', 20, -30, 126, 14);
    expect(preview.width).toBe(384);
    expect(preview.height).toBe(334);
    expect(preview.x).toBe(0);
    const northwest = resizePreview(rect, 'nw', 20, -30, 126, 14);
    expect(northwest).toMatchObject({ x: 20, y: -30, width: 344, height: 394 });
    expect(northwest.x + northwest.width).toBe(364);
    expect(northwest.y + northwest.height).toBe(364);
    expect(resizePreview(rect, 'se', -1000, -1000, 126, 14, { w: 2, h: 1 })).toMatchObject({
      width: 238,
      height: 112,
    });
  });
  it.each(['nw', 'ne', 'sw', 'se'] as ResizeCorner[])(
    '%s keeps the opposite anchor fixed with snap hysteresis',
    (corner) => {
      const west = corner.includes('w'),
        north = corner.includes('n');
      const anchor = { x: rect.x + (west ? rect.w : 0), y: rect.y + (north ? rect.h : 0) };
      const moved = resizeFromCornerHysteretic(
        rect,
        corner,
        west ? -67 : 67,
        north ? -67 : 67,
        126,
      );
      expect(moved).toMatchObject({ w: 4, h: 4 });
      expect(moved.x + (west ? moved.w : 0)).toBe(anchor.x);
      expect(moved.y + (north ? moved.h : 0)).toBe(anchor.y);
      expect(
        resizeFromCornerHysteretic(rect, corner, west ? -62 : 62, north ? -62 : 62, 126, moved),
      ).toEqual(moved);
      const reversed = resizeFromCornerHysteretic(
        rect,
        corner,
        west ? -58 : 58,
        north ? -58 : 58,
        126,
        moved,
      );
      expect(reversed).toEqual(rect);
    },
  );
  it.each(['nw', 'ne', 'sw', 'se'] as ResizeCorner[])(
    '%s keeps a 28px hit box and the visible stroke 3px outside the frame',
    (corner) => {
      const west = corner.includes('w'),
        north = corner.includes('n');
      const handle = resizeCornerGeometry(100, 80, corner);
      expect(handle).toMatchObject({ hitSize: 28, strokeSize: 12, strokeGap: 3 });
      expect(west ? handle.strokeX + handle.strokeSize : handle.strokeX - 100).toBe(west ? -3 : 3);
      expect(north ? handle.strokeY + handle.strokeSize : handle.strokeY - 80).toBe(north ? -3 : 3);
      expect(handle.hitX + handle.hitSize / 2).toBe(west ? -3 : 103);
      expect(handle.hitY + handle.hitSize / 2).toBe(north ? -3 : 83);
      expect(handle.strokeX).toBeGreaterThanOrEqual(handle.hitX);
      expect(handle.strokeX + handle.strokeSize).toBeLessThanOrEqual(handle.hitX + handle.hitSize);
      expect(handle.strokeY).toBeGreaterThanOrEqual(handle.hitY);
      expect(handle.strokeY + handle.strokeSize).toBeLessThanOrEqual(handle.hitY + handle.hitSize);
    },
  );
  it.each(['nw', 'ne', 'sw', 'se'] as ResizeCorner[])(
    '%s produces unscaled frame bounds with the opposite corner anchored',
    (corner) => {
      const west = corner.includes('w'),
        north = corner.includes('n');
      const frame = resizePreview(
        rect,
        corner,
        west ? 20 : -20,
        north ? 30 : -30,
        126,
        14,
        { w: 2, h: 2 },
        { w: 4, h: 4 },
      );
      expect(frame.width).toBe(344);
      expect(frame.height).toBe(334);
      expect(frame.x + (west ? frame.width : 0)).toBe(west ? 364 : 0);
      expect(frame.y + (north ? frame.height : 0)).toBe(north ? 364 : 0);
      expect(
        resizePreview(
          rect,
          corner,
          west ? -1000 : 1000,
          north ? -1000 : 1000,
          126,
          14,
          { w: 2, h: 2 },
          { w: 4, h: 4 },
        ),
      ).toMatchObject({ width: 490, height: 490 });
    },
  );
});

describe('single slider orientation', () => {
  it.each([
    [490, 112, 'horizontal'],
    [112, 490, 'vertical'],
    [238, 238, 'vertical'],
    [390, 238, 'horizontal'],
  ])('uses the larger track for %s × %s pixels', (width, height, expected) => {
    expect(sliderOrientation(Number(width), Number(height))).toBe(expected);
  });
  it('resolves controls from one snapped draft footprint', () => {
    const pitch = 112 + 14,
      gap = 14;
    const draft = { w: 1, h: 3 };
    const pixelWidth = draft.w * pitch - gap,
      pixelHeight = draft.h * pitch - gap;
    expect(sliderOrientation(pixelWidth, pixelHeight)).toBe('vertical');
    expect(buttonIconSize(pixelWidth, pixelHeight)).toBe(38);
    const wideDraft = { w: 3, h: 1 };
    expect(sliderOrientation(wideDraft.w * pitch - gap, wideDraft.h * pitch - gap)).toBe(
      'horizontal',
    );
    expect(buttonIconSize(84, 72)).toBeCloseTo(24.48);
    expect(buttonIconSize(0, 0)).toBe(0);
    expect(buttonIconSize(0, 0, true)).toBe(20);
  });
  it('blocks the slider value axis using slot pixels and compact strip orientation', () => {
    expect(availableGestures('slider', 112, 352)).toContain('swipeLeft');
    expect(availableGestures('slider', 112, 352)).not.toContain('swipeUp');
    expect(availableGestures('slider', 112, 112, true)).toContain('swipeUp');
    expect(availableGestures('slider', 112, 112, true)).not.toContain('swipeLeft');
  });
});

describe('move origin projection', () => {
  const geometry = { gridLeft: 100, gridTop: 50, scale: 1.25, pitch: 126.5, gap: 14.25 };
  it('keeps the grabbed point attached and snaps by tile origin regardless of grab position', () => {
    const source = { x: 2, y: 1 },
      origin = {
        x: source.x * geometry.pitch + geometry.gap,
        y: source.y * geometry.pitch + geometry.gap,
      };
    const pointerOffsets = [
      { x: 0, y: 0 },
      { x: 40.5, y: 62.25 },
      { x: 126.4, y: 20 },
    ];
    const projections = pointerOffsets.map((offset) =>
      projectMoveOrigin(
        geometry.gridLeft + (origin.x + offset.x) * geometry.scale + 37.5,
        geometry.gridTop + (origin.y + offset.y) * geometry.scale - 18.75,
        geometry,
        { x: offset.x, y: offset.y },
        source,
      ),
    );
    for (const result of projections)
      expect(result).toMatchObject({ x: 2, y: 1, translateX: 30, translateY: -15 });
    const moved = pointerOffsets.map((offset) =>
      projectMoveOrigin(
        geometry.gridLeft + (origin.x + offset.x + geometry.pitch * 0.6) * geometry.scale,
        geometry.gridTop + (origin.y + offset.y) * geometry.scale,
        geometry,
        { x: offset.x, y: offset.y },
        source,
      ),
    );
    expect(moved.map((p) => p.x)).toEqual([3, 3, 3]);
  });
  it('uses Math.round half ties on either side, including negative candidate coordinates', () => {
    const at = (originX: number) =>
      projectMoveOrigin(
        100 + originX,
        50,
        { ...geometry, scale: 1 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ).x;
    expect(at(geometry.gap + geometry.pitch * 0.5 - 0.01)).toBe(0);
    expect(at(geometry.gap + geometry.pitch * 0.5)).toBe(1);
    expect(at(geometry.gap + geometry.pitch * -0.5 + 0.01)).toBe(0);
    expect(at(geometry.gap + geometry.pitch * -0.5)).toBe(0);
    expect(at(geometry.gap + geometry.pitch * -0.5 - 0.01)).toBe(-1);
  });
});

describe('press ripple geometry', () => {
  it('centers at the pointer and reaches the farthest corner with uniform scale correction', () => {
    expect(pressRippleGeometry(100, 60, 100, 80, { left: 50, top: 50 })).toMatchObject({
      x: 50,
      y: 30,
    });
    const scaled = pressRippleGeometry(100, 60, 95, 62, { left: 50, top: 50 }, 0.9);
    expect(scaled.x).toBeCloseTo(44.444444);
    expect(scaled.y).toBeCloseTo(10);
    const radius = scaled.diameter / 2;
    expect(Math.hypot(scaled.x, scaled.y)).toBeLessThanOrEqual(radius);
    expect(Math.hypot(100 - scaled.x, 60 - scaled.y)).toBeCloseTo(radius);
  });
});

describe('configured pull state', () => {
  it('uses an 8px slop, locks the dominant axis once, and never redirects an unbound pull', () => {
    const bindings = pullBindingsFor(prev, 0);
    const start = beginPull(1, 0, 0, 0, 200, 200);
    const seven = updatePull(start, 7, 0, bindings);
    expect(seven.state.movedBeyondSlop).toBe(false);
    expect(seven.snapshot).toBeNull();

    const diagonal = updatePull(start, 20, 15, bindings);
    expect(diagonal.state.lockedAxis).toBe('x');
    expect(diagonal.snapshot).toBeNull(); // right is unbound; down does not steal the pull
    const later = updatePull(diagonal.state, 100, 120, bindings);
    expect(later.state.lockedAxis).toBe('x');
    expect(later.snapshot).toBeNull();
    expect(updatePull(start, 80, 0, bindings).snapshot).toBeNull();
  });

  it('breaks an exact diagonal tie toward y, then ignores later cross-axis movement', () => {
    const bindings = { swipeDown: pullBindingsFor(prev, 0).swipeDown };
    const first = updatePull(beginPull(2, 0, 0, 0, 200, 200), 8, 8, bindings);
    expect(first.state.lockedAxis).toBe('y');
    expect(first.snapshot).toMatchObject({ direction: 'swipeDown', axis: 'y', offset: 8 });
    const later = updatePull(first.state, 100, 20, bindings);
    expect(later.state.lockedAxis).toBe('y');
    expect(later.snapshot).toMatchObject({ direction: 'swipeDown', offset: 20 });
    expect(updatePull(later.state, 100, -100, bindings).snapshot).toBeNull(); // up is not configured
  });

  it('arms at a quarter of the axis, clamped to 20–48px, and only hands off a current variant', () => {
    const bindings = pullBindingsFor(prev, 0);
    const start = beginPull(3, 0, 0, 0, 200, 200);
    expect(updatePull(start, 0, 47.99, bindings).snapshot?.armed).toBe(false);
    const armed = updatePull(start, 0, 48, bindings);
    expect(armed.snapshot).toMatchObject({ threshold: 48, distance: 48, progress: 1, armed: true });
    expect(updatePull(beginPull(3, 0, 0, 0, 40, 40), 0, 20, bindings).snapshot?.threshold).toBe(20);
    expect(updatePull(beginPull(3, 0, 0, 0, 120, 120), 0, 30, bindings).snapshot?.threshold).toBe(
      30,
    );
    expect(updatePull(beginPull(3, 0, 0, 0, 300, 300), 0, 48, bindings).snapshot?.threshold).toBe(
      48,
    );
    const overshoot = updatePull(armed.state, 0, 58, bindings);
    expect(overshoot.snapshot?.armed).toBe(true);
    const reversedBelowThreshold = updatePull(overshoot.state, 0, 47.99, bindings);
    expect(reversedBelowThreshold.snapshot?.armed).toBe(false);
    expect(pullHandoffProgress(reversedBelowThreshold.snapshot!)).toBe(0);
    expect(pullHandoffProgress(armed.snapshot!)).toBe(1);
    const scenario = updatePull(
      start,
      0,
      96,
      pullBindingsFor(
        {
          ...prev,
          scenario: {
            triggers: {
              swipeDown: {
                steps: [{ id: 'toggle', kind: 'action', action: { id: 'media.toggle' } }],
              },
            },
            events: [],
          },
        },
        0,
      ),
    ).snapshot!;
    expect(pullHandoffProgress(scenario)).toBe(0);
  });

  it('halves variant and scenario travel limits and bounds their rubber tails', () => {
    const scenarioControl: ControlConfig = {
      ...prev,
      scenario: {
        triggers: {
          swipeDown: {
            steps: [{ id: 'toggle', kind: 'action', action: { id: 'media.toggle' } }],
          },
        },
        events: [],
      },
    };
    const scenario = updatePull(
      beginPull(4, 0, 0, 0, 200, 200),
      0,
      100,
      pullBindingsFor(scenarioControl, 0),
    ).snapshot!;
    expect(scenario.effect).toEqual({ kind: 'scenario', trigger: 'swipeDown', title: 'Pull Down' });
    expect(scenario.offset).toBeGreaterThan(25); // E/8 is 25px.
    expect(scenario.offset).toBeLessThan(34); // no more than the stated 0.18*T rubber tail.
    const variant = updatePull(
      beginPull(4, 0, 0, 0, 200, 200),
      0,
      100,
      pullBindingsFor(prev, 0),
    ).snapshot!;
    expect(variant.effect.kind).toBe('variant');
    expect(variant.offset).toBeGreaterThan(50); // E/4 is 50px.
    expect(variant.offset).toBeLessThan(59);
  });

  it('keeps bindings resolving to the active variant out of the pull map', () => {
    const one: ControlConfig = {
      ...prev,
      variants: [{ id: 'only', label: 'Only' }],
      scenario: {
        triggers: {
          swipeDown: {
            steps: [
              {
                id: 'next',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'self', variant: 'next' } },
              },
            ],
          },
        },
        events: [],
      },
    };
    expect(pullBindingsFor(one, 0)).toEqual({});
  });

  it('uses canonical pull scenarios and previews only one unconditional self state change', () => {
    const simple: ControlConfig = {
      ...prev,
      scenario: {
        triggers: {
          swipeRight: {
            steps: [
              {
                id: 'step',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'self', variant: 'next' } },
              },
            ],
          },
        },
        events: [],
      },
    };
    expect(pullBindingsFor(simple, 0).swipeRight).toEqual({ kind: 'variant', variant: 1 });

    const scenario: ControlConfig = {
      ...simple,
      scenario: {
        triggers: {
          swipeRight: {
            steps: [
              {
                id: 'first',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'self', variant: 'next' } },
              },
              { id: 'second', kind: 'action', action: { id: 'media.toggle' } },
            ],
          },
        },
        events: [],
      },
    };
    expect(pullBindingsFor(scenario, 0).swipeRight).toEqual({
      kind: 'scenario',
      trigger: 'swipeRight',
      title: 'Pull Right',
    });

    const emptyOverride: ControlConfig = {
      ...simple,
      scenario: {
        triggers: {
          swipeRight: {
            steps: [
              {
                id: 'base',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'self', variant: 'next' } },
              },
            ],
            byState: { 'all-media': [] },
          },
        },
        events: [],
      },
    };
    expect(pullBindingsFor(emptyOverride, 0).swipeRight).toMatchObject({ kind: 'scenario' });
  });
});

describe('slider fill readiness', () => {
  const base = {
    sourceKey: 'volume:system',
    previousSourceKey: 'volume:system',
    vertical: true,
    previousVertical: true,
    ready: true,
    dragging: false,
    reducedMotion: false,
  };
  it('animates only finite numeric changes from the same ready source and orientation', () => {
    expect(shouldAnimateSliderFill({ ...base, level: 0.4, previousLevel: 0.65 })).toBe(true);
    expect(shouldAnimateSliderFill({ ...base, level: 0.65, previousLevel: null })).toBe(false);
    expect(shouldAnimateSliderFill({ ...base, level: null, previousLevel: 0.65 })).toBe(false);
    expect(
      shouldAnimateSliderFill({
        ...base,
        level: 0.4,
        previousLevel: 0.65,
        sourceKey: 'volume:spotify',
      }),
    ).toBe(false);
    expect(
      shouldAnimateSliderFill({ ...base, level: 0.4, previousLevel: 0.65, vertical: false }),
    ).toBe(false);
    expect(
      shouldAnimateSliderFill({ ...base, level: 0.4, previousLevel: 0.65, ready: false }),
    ).toBe(false);
    expect(
      shouldAnimateSliderFill({ ...base, level: 0.4, previousLevel: 0.65, dragging: true }),
    ).toBe(false);
    expect(
      shouldAnimateSliderFill({ ...base, level: 0.4, previousLevel: 0.65, reducedMotion: true }),
    ).toBe(false);
  });
});

describe('actions', () => {
  it('a sequence runs its steps in order, including plugin actions', async () => {
    install(corePlugin);
    const log: unknown[] = [];
    actions.set('test.log', { id: 'test.log', title: 'log', run: (a) => void log.push(a.n) });
    await runAction({
      id: 'sequence',
      args: {
        steps: [
          { id: 'test.log', args: { n: 1 } },
          { id: 'delay', args: { ms: 5 } },
          { id: 'test.log', args: { n: 2 } },
        ],
      },
    });
    expect(log).toEqual([1, 2]);
    await expect(runAction({ id: 'nope' })).rejects.toThrow('Unknown action');
  });
});

describe('moveVariant', () => {
  it('reorders states and remaps the current index without changing stable scenario references', () => {
    const c = {
      id: 'c',
      name: 'c',
      type: 'button',
      variants: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
      scenario: {
        triggers: {
          press: {
            steps: [
              {
                id: 'state',
                kind: 'action' as const,
                action: { id: 'button.variant', args: { target: 'self', variant: 'state-1' } },
              },
            ],
          },
        },
        events: [],
      },
    } as ControlConfig;
    expect(moveVariant(c, 0, 0, 2)).toBe(2);
    expect(c.variants.map((v) => v.label)).toEqual(['b', 'c', 'a']);
    expect(c.scenario?.triggers.press?.steps[0]).toMatchObject({
      action: { args: { variant: 'state-1' } },
    });
    expect(moveVariant(c, 1, 2, 0)).toBe(2);
    expect(c.variants.map((v) => v.label)).toEqual(['a', 'b', 'c']);
    expect(moveVariant(c, 1, 0, 5)).toBe(1);
  });

  it('keeps stable scenario references through reorder and repairs only deleted self targets', () => {
    const c: ControlConfig = {
      id: 'b',
      name: 'b',
      type: 'button',
      variants: [
        { id: 'off', label: 'Off' },
        { id: 'on', label: 'On' },
        { id: 'idle', label: 'Idle' },
      ],
      scenario: {
        triggers: {
          press: {
            steps: [
              {
                id: 'self',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'self', variant: 'off' } },
              },
            ],
            byState: { off: [], on: [] },
          },
          release: {
            steps: [
              {
                id: 'external',
                kind: 'action',
                action: { id: 'button.variant', args: { target: 'other', variant: 'off' } },
              },
            ],
          },
        },
        events: [],
      },
      stateBinding: {
        variableId: 'flag',
        cases: [
          { value: false, stateId: 'off' },
          { value: true, stateId: 'on' },
        ],
      },
      stateRoles: { off: 'off', on: 'on' },
    };
    expect(moveVariant(c, 0, 0, 2)).toBe(2);
    expect(c.scenario?.triggers.press?.byState).toEqual({ off: [], on: [] });
    expect(c.scenario?.triggers.press?.steps[0]).toMatchObject({
      action: { args: { variant: 'off' } },
    });
    expect(removeVariant(c, 2, 2)).toBe(1);
    expect(c.variants.map((variant) => variant.id)).toEqual(['on', 'idle']);
    expect(c.scenario?.triggers.press?.byState).toEqual({ on: [] });
    expect(c.scenario?.triggers.press?.steps[0]).toMatchObject({
      action: { args: { variant: 'idle' } },
    });
    expect(c.scenario?.triggers.release?.steps[0]).toMatchObject({
      action: { args: { target: 'other', variant: 'off' } },
    });
    expect(c.stateBinding?.cases).toEqual([{ value: true, stateId: 'on' }]);
    expect(c.stateRoles).toBeUndefined();
  });
});

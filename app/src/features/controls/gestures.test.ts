import { afterEach, describe, expect, it, vi } from 'vitest';
import { gestures } from './gestures';
import type { PullBindings } from './interaction';
import type { Trigger } from '../automation/scenario';

class PointerNode extends EventTarget {
  setPointerCapture = vi.fn();
  getBoundingClientRect = vi.fn(() => ({ left: 10, top: 20, right: 210, bottom: 220, width: 200, height: 200,
    x: 10, y: 20, toJSON: () => ({}) } as DOMRect));
}

function send(node: PointerNode, type: string, pointerId: number, x: number, y: number, button = 0) {
  const event = new Event(type);
  Object.defineProperties(event, {
    pointerId: { value: pointerId }, clientX: { value: x }, clientY: { value: y }, button: { value: button },
  });
  node.dispatchEvent(event);
}

function setup() {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const node = new PointerNode();
  const order: string[] = [];
  const onTrigger = vi.fn((trigger: Trigger) => order.push(trigger));
  const captureTrigger = vi.fn((_trigger: Trigger, _id: string) => undefined);
  const action = gestures(node as unknown as HTMLElement, { onGesture: vi.fn(), onTrigger, captureTrigger });
  return { node, order, onTrigger, captureTrigger, action, set now(value: number) { now = value; } };
}

describe('pointer gesture lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('dispatches Press then Release as one paired short activation', () => {
    const test = setup();
    send(test.node, 'pointerdown', 1, 50, 50);
    test.now = 80;
    send(test.node, 'pointerup', 1, 50, 50);
    expect(test.order).toEqual(['press', 'release']);
    expect(test.captureTrigger).toHaveBeenCalledWith('press', expect.any(String));
    expect(test.captureTrigger).toHaveBeenCalledWith('release', expect.any(String));
    expect(test.action.destroy).toBeTypeOf('function');
    test.action.destroy();
  });

  it('fires hold at 550ms, but not at 549ms, and sends Long press release once', () => {
    vi.useFakeTimers();
    const test = setup();
    send(test.node, 'pointerdown', 1, 50, 50);
    test.now = 549;
    vi.advanceTimersByTime(549);
    expect(test.order).toEqual([]);
    test.now = 550;
    vi.advanceTimersByTime(1);
    expect(test.order).toEqual(['longPress']);
    test.now = 551;
    send(test.node, 'pointerup', 1, 50, 50);
    expect(test.order).toEqual(['longPress', 'longPressRelease']);
    expect(vi.getTimerCount()).toBe(0);
    test.action.destroy();
  });

  it('handles pointerup at the hold boundary before the timer task without a duplicate', () => {
    vi.useFakeTimers();
    const test = setup();
    send(test.node, 'pointerdown', 1, 50, 50);
    test.now = 550;
    send(test.node, 'pointerup', 1, 50, 50);
    vi.runOnlyPendingTimers();
    expect(test.order).toEqual(['longPress', 'longPressRelease']);
    expect(vi.getTimerCount()).toBe(0);
    test.action.destroy();
  });

  it('keeps a 7px move within hold slop and treats an 8px move as pull movement', () => {
    vi.useFakeTimers();
    const within = setup();
    send(within.node, 'pointerdown', 1, 50, 50);
    testTime(within, 100);
    send(within.node, 'pointermove', 1, 57, 50);
    send(within.node, 'pointerup', 1, 57, 50);
    expect(within.order).toEqual(['press', 'release']);
    within.action.destroy();

    const beyond = setup();
    const onPullEnd = vi.fn();
    const onGesture = vi.fn();
    const pullNode = new PointerNode();
    const bindings: PullBindings = { swipeRight: { kind: 'scenario', trigger: 'swipeRight', title: 'Pull Right' } };
    const pullAction = gestures(pullNode as unknown as HTMLElement, { onGesture, onTrigger: vi.fn(), onPullEnd,
      pullBindings: bindings });
    send(pullNode, 'pointerdown', 2, 50, 50);
    send(pullNode, 'pointermove', 2, 58, 50);
    testTime(beyond, 80);
    send(pullNode, 'pointerup', 2, 58, 50);
    expect(onPullEnd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ distance: 8, armed: false }), false);
    expect(onGesture).not.toHaveBeenCalled();
    pullAction.destroy();
  });

  it('captures geometry and bindings at down and evaluates the final pointerup sample once', () => {
    const node = new PointerNode(), onGesture = vi.fn(), onPullEnd = vi.fn();
    const bindings: PullBindings = { swipeRight: { kind: 'scenario', trigger: 'swipeRight', title: 'Pull Right' } };
    const action = gestures(node as unknown as HTMLElement, { onGesture, onPullEnd, pullBindings: bindings });
    send(node, 'pointerdown', 7, 20, 20);
    send(node, 'pointerup', 7, 120, 20); // No pointermove: release point still arms it.
    expect(node.getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(onPullEnd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ direction: 'swipeRight', armed: true }), true);
    expect(onGesture).toHaveBeenCalledExactlyOnceWith('swipeRight', expect.objectContaining({ armed: true }), undefined);
    action.destroy();
  });

  it('does not emit a preview or trigger for an unbound pull direction', () => {
    const node = new PointerNode(), onTrigger = vi.fn(), onPull = vi.fn();
    const action = gestures(node as unknown as HTMLElement, { onGesture: vi.fn(), onTrigger, onPull, pullBindings: {} });
    send(node, 'pointerdown', 1, 40, 40);
    send(node, 'pointermove', 1, 120, 40);
    send(node, 'pointerup', 1, 120, 40);
    expect(onPull).toHaveBeenLastCalledWith(null);
    expect(onTrigger).not.toHaveBeenCalled();
    action.destroy();
  });

  it('does not restore pull hysteresis: the final below-threshold release stays unarmed', () => {
    const node = new PointerNode(), onGesture = vi.fn(), onPullEnd = vi.fn();
    const bindings: PullBindings = { swipeRight: { kind: 'scenario', trigger: 'swipeRight', title: 'Pull Right' } };
    const action = gestures(node as unknown as HTMLElement, { onGesture, onPullEnd, pullBindings: bindings });
    send(node, 'pointerdown', 8, 20, 20);
    send(node, 'pointermove', 8, 80, 20);
    send(node, 'pointerup', 8, 67, 20);
    expect(onPullEnd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ distance: 47, armed: false }), false);
    expect(onGesture).not.toHaveBeenCalled();
    action.destroy();
  });

  it('keeps a long hold from turning into a pull after it fires', () => {
    vi.useFakeTimers();
    const test = setup();
    const bindings: PullBindings = { swipeRight: { kind: 'scenario', trigger: 'swipeRight', title: 'Pull Right' } };
    test.action.destroy();
    const onTrigger = vi.fn((trigger: Trigger) => test.order.push(trigger));
    const action = gestures(test.node as unknown as HTMLElement, { onGesture: vi.fn(), onTrigger,
      pullBindings: bindings, captureTrigger: (trigger, id) => `${trigger}:${id}` });
    send(test.node, 'pointerdown', 1, 50, 50);
    test.now = 550;
    vi.advanceTimersByTime(550);
    send(test.node, 'pointermove', 1, 150, 50);
    test.now = 600;
    send(test.node, 'pointerup', 1, 150, 50);
    expect(test.order).toEqual(['longPress', 'longPressRelease']);
    action.destroy();
  });

  it('suppresses a nearby short pair for double tap, while distant taps stay independent', () => {
    vi.useFakeTimers();
    const node = new PointerNode(), order: string[] = [];
    const action = gestures(node as unknown as HTMLElement, { onGesture: vi.fn(), doubleTap: true,
      onTrigger: trigger => order.push(trigger), captureTrigger: (trigger, id) => `${trigger}:${id}` });
    send(node, 'pointerdown', 1, 30, 30);
    send(node, 'pointerup', 1, 30, 30);
    expect(order).toEqual([]);
    send(node, 'pointerdown', 2, 35, 35);
    vi.advanceTimersByTime(100);
    send(node, 'pointerup', 2, 35, 35);
    expect(order).toEqual(['doubleTap']);

    send(node, 'pointerdown', 3, 30, 30);
    send(node, 'pointerup', 3, 30, 30);
    vi.advanceTimersByTime(100);
    send(node, 'pointerdown', 4, 100, 100);
    send(node, 'pointerup', 4, 100, 100);
    expect(order).toEqual(['doubleTap', 'press', 'release']);
    vi.advanceTimersByTime(300);
    expect(order).toEqual(['doubleTap', 'press', 'release', 'press', 'release']);
    action.destroy();
  });

  it('cancels pending short pairs on pointercancel, lost capture, blur, and destroy', () => {
    vi.useFakeTimers();
    for (const type of ['pointercancel', 'lostpointercapture']) {
      const node = new PointerNode(), onTrigger = vi.fn();
      const action = gestures(node as unknown as HTMLElement, { onGesture: vi.fn(), onTrigger, doubleTap: true });
      send(node, 'pointerdown', 1, 20, 20);
      send(node, 'pointerup', 1, 20, 20);
      send(node, 'pointerdown', 2, 20, 20);
      send(node, type, 2, 20, 20);
      expect(onTrigger).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      action.destroy();
    }
  });

  it('ignores a second pointer until the owner releases', () => {
    const node = new PointerNode(), onGesture = vi.fn();
    const action = gestures(node as unknown as HTMLElement, { onGesture });
    send(node, 'pointerdown', 1, 30, 30);
    send(node, 'pointerdown', 2, 40, 40);
    send(node, 'pointerup', 2, 100, 100);
    send(node, 'pointerup', 1, 30, 30);
    expect(onGesture).toHaveBeenCalledExactlyOnceWith('tap');
    expect(node.setPointerCapture).toHaveBeenCalledExactlyOnceWith(1);
    action.destroy();
  });

  it('matches keyboard activation and clears its hold timer on release', () => {
    vi.useFakeTimers();
    const node = new PointerNode(), order: string[] = [];
    const action = gestures(node as unknown as HTMLElement, { onGesture: vi.fn(), onTrigger: trigger => order.push(trigger) });
    const down = new Event('keydown', { bubbles: true });
    const up = new Event('keyup', { bubbles: true });
    Object.defineProperties(down, { key: { value: 'Enter' }, repeat: { value: false } });
    Object.defineProperties(up, { key: { value: 'Enter' } });
    node.dispatchEvent(down);
    vi.advanceTimersByTime(200);
    node.dispatchEvent(up);
    expect(order).toEqual(['press', 'release']);
    vi.runOnlyPendingTimers();
    expect(vi.getTimerCount()).toBe(0);
    action.destroy();
  });
});

function testTime(test: { now: number }, value: number) { test.now = value; }

import { describe, expect, it, vi } from 'vitest';
import {
  canRunContent,
  watchDashboardVisibility,
  watchIntersection,
  type ContentVisibility,
} from './content-visibility';

const eligible: ContentVisibility = {
  runtimeOwner: true,
  editing: false,
  pageVisible: true,
  intersecting: true,
  documentVisible: true,
  dashboardVisible: true,
};

describe('content visibility', () => {
  it.each([
    'runtimeOwner',
    'pageVisible',
    'intersecting',
    'documentVisible',
    'dashboardVisible',
  ] as const)('stops when %s is false', (key) =>
    expect(canRunContent({ ...eligible, [key]: false })).toBe(false),
  );

  it('stops in the editor even when every visibility source is true', () => {
    expect(canRunContent({ ...eligible, editing: true })).toBe(false);
    expect(canRunContent(eligible)).toBe(true);
  });

  it('observes the tile and disconnects its observer on teardown', () => {
    const observer = { observe: vi.fn(), disconnect: vi.fn() } as unknown as IntersectionObserver;
    let callback: IntersectionObserverCallback | undefined;
    const create = vi.fn((value: IntersectionObserverCallback) => {
      callback = value;
      return observer;
    });
    const onChange = vi.fn();
    const node = {} as Element;
    const stop = watchIntersection(node, onChange, create);
    expect(create).toHaveBeenCalledOnce();
    expect(observer.observe).toHaveBeenCalledWith(node);
    expect(callback).toBeDefined();
    callback!([{ isIntersecting: false } as IntersectionObserverEntry], observer);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
    stop();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it('does not let a stale initial visibility query overwrite a newer event', async () => {
    let event!: (visible: boolean) => void;
    let resolveQuery!: (visible: boolean) => void;
    const bridge = {
      listen: async (callback: (visible: boolean) => void) => {
        event = callback;
        return vi.fn();
      },
      isVisible: () =>
        new Promise<boolean>((resolve) => {
          resolveQuery = resolve;
        }),
    };
    const onChange = vi.fn();
    const pending = watchDashboardVisibility(onChange, bridge);
    await Promise.resolve();
    event(false);
    resolveQuery(true);
    const stop = await pending;
    expect(onChange.mock.calls).toEqual([[false]]);
    stop();
  });

  it('detaches native events and ignores later events after disposal', async () => {
    let event!: (visible: boolean) => void;
    const unlisten = vi.fn();
    const bridge = {
      listen: async (callback: (visible: boolean) => void) => {
        event = callback;
        return unlisten;
      },
      isVisible: async () => true,
    };
    const onChange = vi.fn();
    const stop = await watchDashboardVisibility(onChange, bridge);
    expect(onChange.mock.calls).toEqual([[true]]);
    stop();
    event(false);
    expect(unlisten).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
  });
});

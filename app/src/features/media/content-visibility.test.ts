import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canRunContent,
  watchDashboardVisibility,
  type ContentVisibility,
} from './content-visibility';

const native = vi.hoisted(() => ({
  emit: (_visible: boolean, _revision: number) => {},
  unlisten: vi.fn(),
  query: () => Promise.resolve(true),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: async (
      _name: string,
      handler: (event: { payload: { visible: boolean; revision: number } }) => void,
    ) => {
      native.emit = (visible, revision) => handler({ payload: { visible, revision } });
      return native.unlisten;
    },
    isVisible: () => native.query(),
  }),
}));

beforeEach(() => {
  native.unlisten.mockClear();
  native.query = () => Promise.resolve(true);
});

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

  it('does not let a stale initial visibility query overwrite a newer event', async () => {
    let resolveQuery!: (visible: boolean) => void;
    native.query = () => new Promise<boolean>((resolve) => (resolveQuery = resolve));
    const onChange = vi.fn();
    const pending = watchDashboardVisibility(onChange);
    await Promise.resolve();
    native.emit(false, 1);
    resolveQuery(true);
    const stop = await pending;
    expect(onChange.mock.calls).toEqual([[false]]);
    stop();
  });

  it('ignores out-of-order events, and detaches and ignores later events after disposal', async () => {
    const onChange = vi.fn();
    const stop = await watchDashboardVisibility(onChange);
    expect(onChange.mock.calls).toEqual([[true]]);
    native.emit(false, 5);
    native.emit(true, 4);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    stop();
    native.emit(true, 6);
    expect(native.unlisten).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

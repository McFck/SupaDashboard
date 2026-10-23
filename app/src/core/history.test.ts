import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editableChanged, editableSnapshot, SnapshotHistory } from './history.svelte';
import { DEFAULTS } from './settings.svelte';

describe('settings history', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces edits, then undoes and redoes without recording the applied snapshots', () => {
    let current = { size: 1 };
    let status = { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' };
    const stack = new SnapshotHistory(current, next => (current = next), next => (status = next));
    current.size = 2;
    stack.observe(current);
    vi.advanceTimersByTime(200);
    current.size = 3;
    stack.observe(current);
    vi.advanceTimersByTime(400);
    expect(status).toMatchObject({ canUndo: true, undoLabel: 'Change settings' });
    stack.undo();
    stack.observe(current);
    vi.advanceTimersByTime(400);
    expect(current.size).toBe(1);
    expect(status).toMatchObject({ canUndo: false, canRedo: true, redoLabel: 'Change settings' });
    stack.redo();
    expect(current.size).toBe(3);
  });

  it('drops redo the moment a new edit starts, before the debounce settles', () => {
    let current = { size: 1 };
    let status = { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' };
    const stack = new SnapshotHistory(current, next => (current = next), next => (status = next));
    current = { size: 2 };
    stack.observe(current);
    vi.advanceTimersByTime(400);
    stack.undo();
    expect(status.canRedo).toBe(true);
    stack.observe({ size: 5 });
    expect(status).toMatchObject({ canRedo: false, canUndo: true });
  });

  it('names explicit steps, discards redo after a new edit, and caps the stack', () => {
    let current = { value: 0 };
    let status = { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' };
    const recorded: string[] = [];
    const stack = new SnapshotHistory(current, next => (current = next), next => (status = next),
      label => recorded.push(label), 400, 2);
    current.value = 1;
    stack.commit('Delete Mixer', current);
    vi.advanceTimersByTime(400);
    expect(status.undoLabel).toBe('Delete Mixer');
    expect(recorded).toEqual(['Delete Mixer']);
    current.value = 2;
    stack.observe(current);
    vi.advanceTimersByTime(400);
    stack.undo();
    current.value = 3;
    stack.observe(current);
    vi.advanceTimersByTime(400);
    expect(status.canRedo).toBe(false);
    stack.undo();
    stack.undo();
    expect(current.value).toBe(0);
    expect(status.canUndo).toBe(false);
  });

  it('treats remote replacement as the new baseline', () => {
    let current = { value: 0 };
    let status = { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' };
    const stack = new SnapshotHistory(current, next => (current = next), next => (status = next));
    current.value = 1;
    stack.observe(current);
    stack.remote({ value: 9 });
    current = { value: 9 };
    stack.observe(current);
    vi.advanceTimersByTime(400);
    expect(status).toMatchObject({ canUndo: false, canRedo: false });
    stack.undo();
    expect(current.value).toBe(9);
  });

  it('keeps undo history and the live variant after a remote variant change', () => {
    const current = structuredClone(DEFAULTS);
    let status = { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' };
    const stack = new SnapshotHistory(editableSnapshot(current), next => Object.assign(current, next),
      next => (status = next));
    current.skin = 'subway';
    stack.observe(editableSnapshot(current));
    vi.advanceTimersByTime(400);
    const remote = structuredClone(current);
    remote.variants.toggle = 1;
    expect(editableChanged(current, remote)).toBe(false);
    if (editableChanged(current, remote)) stack.remote(editableSnapshot(remote));
    Object.assign(current, remote);
    stack.observe(editableSnapshot(current));
    vi.advanceTimersByTime(400);
    expect(status.canUndo).toBe(true);
    stack.undo();
    expect(current.skin).toBe(DEFAULTS.skin);
    expect(current.variants.toggle).toBe(1);
  });

  it('does not offer a destructive-step toast after an immediate undo', () => {
    let current = { value: 0 };
    const recorded = vi.fn();
    const stack = new SnapshotHistory(current, next => (current = next), () => {}, recorded);
    current.value = 1;
    stack.commit('Delete Mixer', current);
    stack.undo();
    expect(current.value).toBe(0);
    expect(recorded).not.toHaveBeenCalled();
  });

  it('does not carry a no-op commit label into a later edit', () => {
    const current = { value: 0 };
    let undoLabel = '';
    const stack = new SnapshotHistory(current, () => {}, next => (undoLabel = next.undoLabel));
    stack.commit('Reset everything', current);
    vi.advanceTimersByTime(400);
    current.value = 1;
    stack.observe(current);
    vi.advanceTimersByTime(400);
    expect(undoLabel).toBe('Change settings');
  });
});

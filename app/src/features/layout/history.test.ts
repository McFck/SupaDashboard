import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyEditableSettings,
  editableChanged,
  editableSnapshot,
  SnapshotHistory,
} from './history.svelte';
import { settings } from '../settings/state.svelte';
import { DEFAULTS } from '../settings/schema';
import {
  addPage,
  deletePage,
  duplicatePage,
  movePlacement,
  renamePage,
  reorderPage,
} from './pages';
import type { ControlConfig } from '../controls/model';

describe('settings history', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces edits, then undoes and redoes without recording the applied snapshots', () => {
    let current = { size: 1 };
    let status = { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' };
    const stack = new SnapshotHistory(
      current,
      (next) => (current = next),
      (next) => (status = next),
    );
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
    const stack = new SnapshotHistory(
      current,
      (next) => (current = next),
      (next) => (status = next),
    );
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
    const stack = new SnapshotHistory(
      current,
      (next) => (current = next),
      (next) => (status = next),
      (label) => recorded.push(label),
      400,
      2,
    );
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
    const stack = new SnapshotHistory(
      current,
      (next) => (current = next),
      (next) => (status = next),
    );
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
    const stack = new SnapshotHistory(
      editableSnapshot(current),
      (next) =>
        Object.assign(current, {
          ...next,
          deck: { ...next.deck, activePage: current.deck.activePage },
        }),
      (next) => (status = next),
    );
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
    const stack = new SnapshotHistory(
      current,
      (next) => (current = next),
      () => {},
      recorded,
    );
    current.value = 1;
    stack.commit('Delete Mixer', current);
    stack.undo();
    expect(current.value).toBe(0);
    expect(recorded).not.toHaveBeenCalled();
  });

  it('does not carry a no-op commit label into a later edit', () => {
    const current = { value: 0 };
    let undoLabel = '';
    const stack = new SnapshotHistory(
      current,
      () => {},
      (next) => (undoLabel = next.undoLabel),
    );
    stack.commit('Reset everything', current);
    vi.advanceTimersByTime(400);
    current.value = 1;
    stack.observe(current);
    vi.advanceTimersByTime(400);
    expect(undoLabel).toBe('Change settings');
  });

  it('keeps live page selection outside undo while page data remains editable', () => {
    const before = structuredClone(settings);
    try {
      settings.deck.pages = [
        structuredClone(DEFAULTS.deck.pages[0]),
        { ...structuredClone(DEFAULTS.deck.pages[0]), id: 'page-second', name: 'Second', cols: 8 },
      ];
      settings.deck.activePage = 'page-second';
      settings.variants.prev = 1;
      const initial = editableSnapshot(settings);
      const stack = new SnapshotHistory(initial, applyEditableSettings, () => {});
      settings.skin = 'subway';
      settings.deck.pages[1].cols = 9;
      stack.observe(editableSnapshot(settings));
      vi.advanceTimersByTime(400);
      stack.undo();
      expect(settings.skin).toBe(DEFAULTS.skin);
      expect(settings.deck.pages[1].cols).toBe(8);
      expect(settings.deck.activePage).toBe('page-second');
      expect(settings.variants.prev).toBe(1);
      stack.redo();
      expect(settings.deck.pages[1].cols).toBe(9);
      expect(settings.deck.activePage).toBe('page-second');
    } finally {
      Object.assign(settings, before);
    }
  });

  it('undoes and redoes page add, rename, duplicate, reorder, move and delete with stable IDs', () => {
    const before = structuredClone(settings);
    try {
      const control: ControlConfig = {
        id: 'history-control',
        name: 'Button',
        type: 'button',
        variants: [{ id: 'state-one', label: 'One' }],
      };
      const skinControl: ControlConfig = {
        id: 'skin-history-control',
        name: 'Skin Button',
        type: 'button',
        variants: [{ id: 'skin-state', label: 'Skin' }],
      };
      const firstPage = {
        ...structuredClone(DEFAULTS.deck.pages[0]),
        id: 'history-page-one',
        name: 'First',
        items: [{ id: 'history-item', control: control.id, x: 0, y: 0, w: 1, h: 1 }],
      };
      const secondPage = {
        ...structuredClone(DEFAULTS.deck.pages[0]),
        id: 'history-page-two',
        name: 'Second',
        items: [],
      };
      settings.deck.pages = [firstPage, secondPage];
      settings.deck.activePage = secondPage.id;
      settings.controls = [control, skinControl];
      settings.skinLayouts = {
        subway: {
          [firstPage.id]: {
            strip: [{ id: 'skin-history-item', control: skinControl.id, x: 0, y: 0, w: 1, h: 1 }],
          },
        },
        unavailable: { [firstPage.id]: { removed: [] } },
      };
      settings.variants = { [control.id]: 0 };
      const states = [editableSnapshot(settings)];
      const stack = new SnapshotHistory(states[0], applyEditableSettings, () => {});
      const record = (label: string) => {
        const next = editableSnapshot(settings);
        stack.commit(label, next);
        vi.advanceTimersByTime(400);
        states.push(editableSnapshot(settings));
      };

      const added = addPage(
        settings.deck.pages,
        settings.controls,
        firstPage.id,
        settings.skinLayouts,
      )!;
      settings.deck.pages = added.pages;
      record('Add page');
      const renamed = renamePage(settings.deck.pages, added.page.id, '工作')!;
      settings.deck.pages = renamed.pages;
      record('Rename page');
      const duplicated = duplicatePage(
        settings.deck.pages,
        firstPage.id,
        settings.controls,
        settings.variants,
        settings.skinLayouts,
      )!;
      settings.deck.pages = duplicated.pages;
      settings.controls = duplicated.controls;
      settings.variants = duplicated.variants;
      settings.skinLayouts = duplicated.skinLayouts;
      const copiedSkinItem = settings.skinLayouts.subway[duplicated.page.id].strip[0];
      expect(copiedSkinItem.id).not.toBe('skin-history-item');
      expect(copiedSkinItem.control).not.toBe(skinControl.id);
      expect(settings.skinLayouts.unavailable[duplicated.page.id].removed).toEqual([]);
      record('Duplicate page');
      settings.deck.pages = reorderPage(settings.deck.pages, secondPage.id, 0)!.pages;
      record('Reorder pages');
      settings.deck.pages = movePlacement(
        settings.deck.pages,
        firstPage.id,
        secondPage.id,
        'history-item',
      )!.pages;
      record('Move widget');
      const deleted = deletePage(
        settings.deck.pages,
        duplicated.page.id,
        settings.controls,
        settings.variants,
        settings.skinLayouts,
      )!;
      settings.deck.pages = deleted.pages;
      settings.controls = deleted.controls;
      settings.variants = deleted.variants;
      settings.skinLayouts = deleted.skinLayouts;
      record('Delete page');

      for (let index = states.length - 2; index >= 0; index--) {
        stack.undo();
        expect(editableSnapshot(settings)).toEqual(states[index]);
        expect(settings.deck.activePage).toBe(secondPage.id);
      }
      for (let index = 1; index < states.length; index++) {
        stack.redo();
        expect(editableSnapshot(settings)).toEqual(states[index]);
        expect(settings.deck.activePage).toBe(secondPage.id);
      }
      expect(settings.deck.pages.flatMap((page) => page.items).map((item) => item.id)).toContain(
        'history-item',
      );
      expect(settings.controls.map((entry) => entry.id)).toContain('history-control');
      expect(settings.skinLayouts.subway[firstPage.id].strip[0].id).toBe('skin-history-item');
      expect(settings.skinLayouts.subway).not.toHaveProperty(duplicated.page.id);
    } finally {
      Object.assign(settings, before);
    }
  });
});

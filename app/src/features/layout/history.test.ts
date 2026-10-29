import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyEditableSettings,
  editableChanged,
  editableSnapshot,
  SnapshotHistory,
} from './history.svelte';
import { settings } from '../settings/state.svelte';
import { DEFAULTS } from '../settings/defaults';
import { addPage, deletePage, duplicatePage, renamePage, reorderPage } from './pages';
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
    stack.commit('Delete Mixer', current);
    current.value = 1;
    stack.observe(current);
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
    current.appletSettings = { subway: { shared: {}, separate: false } };
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
    expect(current.appletSettings).toEqual(DEFAULTS.appletSettings);
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
    stack.commit('Delete Mixer', current);
    current.value = 1;
    stack.observe(current);
    stack.undo();
    expect(current.value).toBe(0);
    expect(recorded).not.toHaveBeenCalled();
  });

  it('gives two commands within the debounce their own undo steps', () => {
    let current = { pages: ['one'] };
    let status = { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' };
    const stack = new SnapshotHistory(
      current,
      (next) => (current = next),
      (next) => (status = next),
    );
    stack.commit('Add page', current);
    current = { pages: ['one', 'two'] };
    stack.observe(current);
    vi.advanceTimersByTime(100);
    stack.commit('Rename page', current);
    current = { pages: ['one', 'renamed'] };
    stack.observe(current);
    vi.advanceTimersByTime(400);
    expect(status.undoLabel).toBe('Rename page');
    stack.undo();
    expect(current.pages).toEqual(['one', 'two']);
    expect(status.undoLabel).toBe('Add page');
    stack.undo();
    expect(current.pages).toEqual(['one']);
  });

  it('records no step for an edit that was reverted before a command', () => {
    let current = { value: 0 };
    let status = { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' };
    const stack = new SnapshotHistory(
      current,
      (next) => (current = next),
      (next) => (status = next),
    );
    stack.observe({ value: 1 });
    stack.commit('Add page', current);
    current = { value: 2 };
    stack.observe(current);
    vi.advanceTimersByTime(400);
    stack.undo();
    expect(current.value).toBe(0);
    expect(status.canUndo).toBe(false);
  });

  it('keeps one undo step for a continuous labelled edit', () => {
    let current = { radius: 0 };
    let status = { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' };
    const stack = new SnapshotHistory(
      current,
      (next) => (current = next),
      (next) => (status = next),
    );
    for (const radius of [1, 2, 3]) {
      stack.edit('Canvas radius', current);
      current = { radius };
      stack.observe(current);
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(400);
    stack.undo();
    expect(current.radius).toBe(0);
    expect(status.canUndo).toBe(false);
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
      settings.appletSettings = { subway: { shared: {}, separate: false } };
      settings.deck.pages[1].cols = 9;
      stack.observe(editableSnapshot(settings));
      vi.advanceTimersByTime(400);
      stack.undo();
      expect(settings.appletSettings).toEqual(DEFAULTS.appletSettings);
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
      const appletControl: ControlConfig = {
        id: 'applet-history-control',
        name: 'Applet Button',
        type: 'button',
        variants: [{ id: 'applet-state', label: 'Applet' }],
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
      settings.controls = [control, appletControl];
      settings.appletLayouts = {
        subway: {
          [firstPage.id]: {
            strip: [
              { id: 'applet-history-item', control: appletControl.id, x: 0, y: 0, w: 1, h: 1 },
            ],
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
        settings.appletLayouts,
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
        settings.appletLayouts,
      )!;
      settings.deck.pages = duplicated.pages;
      settings.controls = duplicated.controls;
      settings.variants = duplicated.variants;
      settings.appletLayouts = duplicated.appletLayouts;
      const copiedAppletItem = settings.appletLayouts.subway[duplicated.page.id].strip[0];
      expect(copiedAppletItem.id).not.toBe('applet-history-item');
      expect(copiedAppletItem.control).not.toBe(appletControl.id);
      expect(settings.appletLayouts.unavailable[duplicated.page.id].removed).toEqual([]);
      record('Duplicate page');
      settings.deck.pages = reorderPage(settings.deck.pages, secondPage.id, 0)!.pages;
      record('Reorder pages');
      const deleted = deletePage(
        settings.deck.pages,
        duplicated.page.id,
        settings.controls,
        settings.variants,
        settings.appletLayouts,
      )!;
      settings.deck.pages = deleted.pages;
      settings.controls = deleted.controls;
      settings.variants = deleted.variants;
      settings.appletLayouts = deleted.appletLayouts;
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
      expect(settings.appletLayouts.subway[firstPage.id].strip[0].id).toBe('applet-history-item');
      expect(settings.appletLayouts.subway).not.toHaveProperty(duplicated.page.id);
    } finally {
      Object.assign(settings, before);
    }
  });
});

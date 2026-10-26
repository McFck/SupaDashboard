import { toast } from 'svelte-sonner';
import { onRemoteSettings, settings } from '../settings/state.svelte';
import type { Deck, Settings } from '../settings/schema';

type Status = { canUndo: boolean; canRedo: boolean; undoLabel: string; redoLabel: string };
type EditableSettings = Omit<Settings, 'variants' | 'deck'> & { deck: Omit<Deck, 'activePage'> };

export function editableSnapshot(source: Settings): EditableSettings {
  const { variants: _runtime, deck, ...editable } = source;
  const { activePage: _activePage, ...editableDeck } = deck;
  return structuredClone({ ...editable, deck: editableDeck });
}

export const editableChanged = (current: Settings, next: Settings) =>
  JSON.stringify(editableSnapshot(current)) !== JSON.stringify(editableSnapshot(next));

export class SnapshotHistory<T> {
  private states: T[];
  private labels: string[] = [];
  private cursor = 0;
  private pending: T | undefined;
  private pendingLabel = '';
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    initial: T,
    private apply: (snapshot: T) => void,
    private update: (status: Status) => void,
    private recorded: (label: string) => void = () => {},
    private delay = 400,
    private limit = 100,
  ) {
    this.states = [structuredClone(initial)];
    this.publish();
  }

  // A pending (not yet debounced) edit already discards the redo branch, so reflect that immediately.
  private publish() {
    const pending = this.pending !== undefined;
    this.update({
      canUndo: pending || this.cursor > 0,
      canRedo: !pending && this.cursor < this.labels.length,
      undoLabel: pending
        ? this.pendingLabel || 'Change settings'
        : (this.labels[this.cursor - 1] ?? ''),
      redoLabel: pending ? '' : (this.labels[this.cursor] ?? ''),
    });
  }

  observe(next: T) {
    const snapshot = structuredClone(next);
    if (JSON.stringify(snapshot) === JSON.stringify(this.pending ?? this.states[this.cursor]))
      return;
    const wasPending = this.pending !== undefined;
    this.pending = snapshot;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
    if (!wasPending) this.publish();
  }

  commit(label: string, current: T) {
    this.pendingLabel = label;
    this.observe(current);
    if (!this.pending) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.pendingLabel = '';
        this.timer = undefined;
      }, this.delay);
    }
  }

  private flush(notify = true) {
    clearTimeout(this.timer);
    this.timer = undefined;
    const next = this.pending;
    this.pending = undefined;
    const label = this.pendingLabel || 'Change settings';
    this.pendingLabel = '';
    if (next === undefined || JSON.stringify(next) === JSON.stringify(this.states[this.cursor])) {
      this.publish();
      return;
    }
    this.states.splice(this.cursor + 1);
    this.labels.splice(this.cursor);
    this.states.push(next);
    this.labels.push(label);
    this.cursor++;
    if (this.labels.length > this.limit) {
      this.states.shift();
      this.labels.shift();
      this.cursor--;
    }
    this.publish();
    if (notify) this.recorded(label);
  }

  undo() {
    this.flush(false);
    if (this.cursor === 0) return;
    this.apply(structuredClone(this.states[--this.cursor]));
    this.publish();
  }

  redo() {
    this.flush();
    if (this.cursor === this.labels.length) return;
    this.apply(structuredClone(this.states[++this.cursor]));
    this.publish();
  }

  remote(next: T) {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    this.pendingLabel = '';
    this.states = [structuredClone(next)];
    this.labels = [];
    this.cursor = 0;
    this.publish();
  }
}

export const history = $state<Status>({
  canUndo: false,
  canRedo: false,
  undoLabel: '',
  redoLabel: '',
});
let timeline: SnapshotHistory<EditableSettings> | undefined;
let undoToast: string | number | undefined;

function dismissUndoToast() {
  if (undoToast !== undefined) toast.dismiss(undoToast);
  undoToast = undefined;
}

/** Variant indices are runtime state outside history; keep each control on the same variant when undo reorders them. */
export function applyEditableSettings(snapshot: EditableSettings) {
  const activePage = settings.deck.activePage;
  const active = new Map(
    settings.controls.map((c) => [c.id, JSON.stringify(c.variants[settings.variants[c.id] ?? 0])]),
  );
  Object.assign(settings, { ...snapshot, deck: { ...snapshot.deck, activePage } });
  for (const c of settings.controls) {
    const index = c.variants.findIndex((v) => JSON.stringify(v) === active.get(c.id));
    if (index >= 0 && index !== (settings.variants[c.id] ?? 0)) settings.variants[c.id] = index;
  }
}

export function startHistory() {
  if (timeline) return;
  timeline = new SnapshotHistory<EditableSettings>(
    editableSnapshot($state.snapshot(settings)),
    applyEditableSettings,
    (status) => Object.assign(history, status),
    (label) => {
      dismissUndoToast();
      if (/^(delete|reset|paste|replace)/i.test(label))
        undoToast = toast(/^delete/i.test(label) ? 'Item deleted' : label, {
          action: { label: 'Revert', onClick: () => undo() },
        });
    },
  );
  onRemoteSettings((next) => {
    if (editableChanged($state.snapshot(settings), next)) {
      dismissUndoToast();
      timeline?.remote(editableSnapshot(next));
    }
  });
  $effect.root(() => {
    $effect(() => timeline?.observe(editableSnapshot($state.snapshot(settings))));
  });
}

export function commit(label: string): void {
  timeline?.commit(label, editableSnapshot($state.snapshot(settings)));
}
export function undo(): void {
  dismissUndoToast();
  timeline?.undo();
}
export function redo(): void {
  dismissUndoToast();
  timeline?.redo();
}

// What the layout editor shows and has selected: the page, the previewed applet and view, the edited slot and the
// selected placement or cell. Effects keep them consistent as pages, applets and views change underneath.
import { get } from 'svelte/store';
import { runtimeView } from '../../../app/runtime/state';
import { layoutPreview, saveLayoutPreview } from '../../../panel/ui/preferences.svelte';
import { appletFor } from '../../applets/deck';
import { settings } from '../../settings/state.svelte';
import type { AppletDef } from '../../applets/contracts';
import type { Selection } from '../grid';
import { pageAfterRemoval, pageById } from '../pages';
import { layoutFor, type LayoutTarget } from '../applet-layouts';

export type EditorStateHost = {
  /** Pages were added, removed or reordered; `ids` is the new order. */
  pagesChanged(ids: string[]): void;
  /** The page, applet or view changed: menus and dialogs opened for the previous one close. */
  leave(): void;
};

function defaultTarget(applet: AppletDef, pageId: string): LayoutTarget {
  return { appletId: applet.id, pageId, slotId: applet.slots[0]?.id ?? 'main' };
}

function storedView(applet: AppletDef) {
  const stored = layoutPreview.views[applet.id];
  return applet.views.some((view) => view.id === stored) ? stored : applet.defaultView;
}

export class LayoutEditorState {
  selection = $state<Selection>(null);
  pageId = $state('');
  viewId = $state('');
  /** The slot the selection belongs to; `target` falls back when it is not shown. */
  selectionTarget = $state<LayoutTarget>({ appletId: '', pageId: '', slotId: '' });
  /** Bumped whenever pages are added, removed or reordered, so awaited actions can detect a stale page. */
  pageGeneration = 0;

  readonly page = $derived(pageById(settings.deck.pages, this.pageId)!);
  /** The shown page decides the applet, so the editor follows page and applet changes made anywhere. */
  readonly applet = $derived(appletFor(this.page));
  readonly slotIds = $derived(this.applet.slots.map((slot) => slot.id));
  readonly target = $derived.by((): LayoutTarget => {
    const current = this.selectionTarget;
    const valid =
      current.appletId === this.applet.id &&
      current.pageId === this.page.id &&
      this.slotIds.includes(current.slotId);
    if (valid) {
      return current;
    }
    return {
      appletId: this.applet.id,
      pageId: this.page.id,
      slotId: this.slotIds[0] ?? 'main',
    };
  });

  private previousAppletId: string;
  private previousViewId: string;
  private previousPageId: string;
  private previousPageOrder = settings.deck.pages.map((entry) => entry.id);

  constructor(private readonly host: EditorStateHost) {
    this.pageId =
      get(runtimeView).activePage || settings.deck.activePage || settings.deck.pages[0].id;
    const applet = this.applet;
    this.viewId = storedView(applet);
    this.selectionTarget = defaultTarget(applet, this.pageId);
    this.previousAppletId = applet.id;
    this.previousViewId = this.viewId;
    this.previousPageId = this.pageId;

    $effect(() => this.reconcilePages());
    $effect(() => this.reconcilePage());
    $effect(() => this.reconcileView());
    $effect(() => this.dropMissingSelection());
  }

  select(next: Selection, target?: LayoutTarget) {
    this.selection = next;
    if (target) {
      this.selectionTarget = target;
    }
  }

  showPage(pageId: string | undefined) {
    if (pageId) {
      this.pageId = pageId;
      this.selection = null;
    }
  }

  /** Whether the editor shows `slot` of `pageId`, so an edit there is what the user looked at. */
  shows(pageId: string, slot: LayoutTarget) {
    return (
      pageId === this.page.id &&
      pageId === slot.pageId &&
      this.applet.id === slot.appletId &&
      this.slotIds.includes(slot.slotId)
    );
  }

  /** A check that stays true while the editor shows `slot` the way it does now. */
  watch(slot: LayoutTarget) {
    const appletId = this.applet.id;
    const viewId = this.viewId;
    const generation = this.pageGeneration;
    return () =>
      this.page.id === slot.pageId &&
      this.applet.id === appletId &&
      this.viewId === viewId &&
      this.pageGeneration === generation &&
      this.slotIds.includes(slot.slotId);
  }

  private reconcilePages() {
    const ids = settings.deck.pages.map((entry) => entry.id);
    const prior = this.previousPageOrder;
    const changed = ids.length !== prior.length || ids.some((id, index) => id !== prior[index]);
    if (!changed) {
      return;
    }
    this.previousPageOrder = ids;
    this.pageGeneration++;
    if (!ids.includes(this.pageId)) {
      this.pageId = pageAfterRemoval(settings.deck.pages, this.pageId, prior) ?? ids[0];
    }
    this.host.pagesChanged(ids);
  }

  /** The shown page or its applet changed: the previewed view and the selection start over. */
  private reconcilePage() {
    const current = this.pageId;
    const applet = this.applet;
    if (current === this.previousPageId && applet.id === this.previousAppletId) {
      return;
    }
    this.previousPageId = current;
    const viewId = applet.id === this.previousAppletId ? this.viewId : storedView(applet);
    this.viewId = viewId;
    this.selection = null;
    this.selectionTarget = defaultTarget(applet, this.page.id);
    this.host.leave();
  }

  /** The previewed applet or view changed: remember the view and keep the selection inside the applet. */
  private reconcileView() {
    const applet = this.applet;
    const viewId = this.viewId;
    if (applet.id === this.previousAppletId && viewId === this.previousViewId) {
      return;
    }
    this.previousAppletId = applet.id;
    this.previousViewId = viewId;
    if (!applet.views.some((entry) => entry.id === viewId)) {
      return;
    }
    layoutPreview.views[applet.id] = viewId;
    if (this.selectionTarget.appletId !== applet.id) {
      this.selectionTarget = defaultTarget(applet, this.page.id);
    }
    this.clearTransient();
    saveLayoutPreview();
  }

  /** Drops a selection whose placement left the edited slot. */
  private dropMissingSelection() {
    const selection = this.selection;
    const selectedId = selection && 'item' in selection ? selection.item : undefined;
    if (!selectedId) {
      return;
    }
    const { appletId, pageId, slotId } = this.target;
    if (
      !layoutFor(settings, appletId, pageId, slotId)?.items.some((item) => item.id === selectedId)
    ) {
      this.selection = null;
    }
  }

  private clearTransient() {
    this.selection = null;
    this.host.leave();
  }
}

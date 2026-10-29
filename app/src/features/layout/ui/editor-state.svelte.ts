// What the layout editor shows and has selected: the page, the previewed applet and view, the edited slot and the
// selected placement or cell. Effects keep them consistent as pages, applets and views change underneath.
import { get } from 'svelte/store';
import { runtimeView } from '../../../app/runtime/state';
import { layoutPreview, saveLayoutPreview } from '../../../panel/ui/preferences.svelte';
import { applets } from '../../plugins/registry';
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

function defaultTarget(applet: AppletDef, pageId: string, viewId: string): LayoutTarget {
  const view =
    applet.views.find((entry) => entry.id === viewId) ??
    applet.views.find((entry) => entry.id === applet.defaultView);
  return { appletId: applet.id, pageId, slotId: view?.slots[0] ?? applet.slots[0]?.id ?? 'main' };
}

function storedView(applet: AppletDef) {
  const stored = layoutPreview.views[applet.id];
  return applet.views.some((view) => view.id === stored) ? stored : applet.defaultView;
}

export class LayoutEditorState {
  selection = $state<Selection>(null);
  pageId = $state('');
  appletId = $state('');
  viewId = $state('');
  /** The slot the selection belongs to; `target` falls back when it is not shown. */
  selectionTarget = $state<LayoutTarget>({ appletId: '', pageId: '', slotId: '' });
  /** Bumped whenever pages are added, removed or reordered, so awaited actions can detect a stale page. */
  pageGeneration = 0;

  readonly page = $derived(pageById(settings.deck.pages, this.pageId)!);
  readonly applet = $derived(applets.get(this.appletId) ?? applets.get('deck')!);
  readonly visibleSlots = $derived(
    this.applet.views.find((view) => view.id === this.viewId)?.slots ?? [],
  );
  readonly target = $derived.by((): LayoutTarget => {
    const current = this.selectionTarget;
    const valid =
      current.appletId === this.applet.id &&
      current.pageId === this.page.id &&
      this.applet.slots.some((slot) => slot.id === current.slotId) &&
      this.visibleSlots.includes(current.slotId);
    if (valid) {
      return current;
    }
    return {
      appletId: this.applet.id,
      pageId: this.page.id,
      slotId: this.visibleSlots[0] ?? this.applet.slots[0]?.id ?? 'main',
    };
  });

  private previousAppletId: string;
  private previousViewId: string;
  private previousActiveAppletId = settings.skin;
  private previousPageId: string;
  private previousPageOrder = settings.deck.pages.map((entry) => entry.id);

  constructor(private readonly host: EditorStateHost) {
    const appletId = applets.has(settings.skin) ? settings.skin : 'deck';
    const applet = applets.get(appletId) ?? applets.get('deck')!;
    this.pageId =
      get(runtimeView).activePage || settings.deck.activePage || settings.deck.pages[0].id;
    this.appletId = appletId;
    this.viewId = storedView(applet);
    this.selectionTarget = defaultTarget(applet, this.pageId, this.viewId);
    this.previousAppletId = appletId;
    this.previousViewId = this.viewId;
    this.previousPageId = this.pageId;

    $effect(() => this.reconcilePages());
    $effect(() => this.reconcilePage());
    $effect(() => this.followDashboardApplet());
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
      this.visibleSlots.includes(slot.slotId)
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
      this.visibleSlots.includes(slot.slotId);
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

  private reconcilePage() {
    const current = this.pageId;
    if (current === this.previousPageId) {
      return;
    }
    this.previousPageId = current;
    this.selection = null;
    this.selectionTarget = defaultTarget(this.applet, this.page.id, this.viewId);
    this.host.leave();
  }

  /** The dashboard switched applets: preview the new one. */
  private followDashboardApplet() {
    const appletId = settings.skin;
    if (appletId === this.previousActiveAppletId) {
      return;
    }
    this.previousActiveAppletId = appletId;
    const applet = applets.get(appletId);
    if (!applet) {
      return;
    }
    this.appletId = applet.id;
    this.viewId = storedView(applet);
    this.selectionTarget = defaultTarget(applet, this.page.id, this.viewId);
    this.clearTransient();
  }

  /** The previewed applet or view changed: remember the view and keep the selection inside it. */
  private reconcileView() {
    const appletId = this.appletId;
    const viewId = this.viewId;
    if (appletId === this.previousAppletId && viewId === this.previousViewId) {
      return;
    }
    this.previousAppletId = appletId;
    this.previousViewId = viewId;
    const applet = applets.get(appletId);
    const view = applet?.views.find((entry) => entry.id === viewId);
    if (!applet || !view) {
      return;
    }
    layoutPreview.views[appletId] = viewId;
    const target = this.selectionTarget;
    if (!view.slots.includes(target.slotId) || target.appletId !== appletId) {
      this.selectionTarget = defaultTarget(applet, this.page.id, viewId);
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

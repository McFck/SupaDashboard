// What the layout editor shows and has selected: the page, the previewed skin and view, the edited slot and the
// selected placement or cell. Effects keep them consistent as pages, skins and views change underneath.
import { get } from 'svelte/store';
import { runtimeView } from '../../../app/runtime/state';
import { layoutPreview, saveLayoutPreview } from '../../../panel/ui/preferences.svelte';
import { skins } from '../../plugins/registry';
import { settings } from '../../settings/state.svelte';
import type { SkinDef } from '../../skins/definition';
import type { Selection } from '../grid';
import { pageAfterRemoval, pageById } from '../pages';
import { layoutFor, type LayoutTarget } from '../skin-layouts';

export type EditorStateHost = {
  /** Pages were added, removed or reordered; `ids` is the new order. */
  pagesChanged(ids: string[]): void;
  /** The page, skin or view changed: menus and dialogs opened for the previous one close. */
  leave(): void;
};

function defaultTarget(skin: SkinDef, pageId: string, viewId: string): LayoutTarget {
  const view =
    skin.views.find((entry) => entry.id === viewId) ??
    skin.views.find((entry) => entry.id === skin.defaultView);
  return { skinId: skin.id, pageId, slotId: view?.slots[0] ?? skin.slots[0]?.id ?? 'main' };
}

function storedView(skin: SkinDef) {
  const stored = layoutPreview.views[skin.id];
  return skin.views.some((view) => view.id === stored) ? stored : skin.defaultView;
}

export class LayoutEditorState {
  selection = $state<Selection>(null);
  pageId = $state('');
  skinId = $state('');
  viewId = $state('');
  /** The slot the selection belongs to; `target` falls back when it is not shown. */
  selectionTarget = $state<LayoutTarget>({ skinId: '', pageId: '', slotId: '' });
  /** Bumped whenever pages are added, removed or reordered, so awaited actions can detect a stale page. */
  pageGeneration = 0;

  readonly page = $derived(pageById(settings.deck.pages, this.pageId)!);
  readonly skin = $derived(skins.get(this.skinId) ?? skins.get('deck')!);
  readonly visibleSlots = $derived(
    this.skin.views.find((view) => view.id === this.viewId)?.slots ?? [],
  );
  readonly target = $derived.by((): LayoutTarget => {
    const current = this.selectionTarget;
    const valid =
      current.skinId === this.skin.id &&
      current.pageId === this.page.id &&
      this.skin.slots.some((slot) => slot.id === current.slotId) &&
      this.visibleSlots.includes(current.slotId);
    if (valid) {
      return current;
    }
    return {
      skinId: this.skin.id,
      pageId: this.page.id,
      slotId: this.visibleSlots[0] ?? this.skin.slots[0]?.id ?? 'main',
    };
  });

  private previousSkinId: string;
  private previousViewId: string;
  private previousActiveSkinId = settings.skin;
  private previousPageId: string;
  private previousPageOrder = settings.deck.pages.map((entry) => entry.id);

  constructor(private readonly host: EditorStateHost) {
    const skinId = skins.has(settings.skin) ? settings.skin : 'deck';
    const skin = skins.get(skinId) ?? skins.get('deck')!;
    this.pageId =
      get(runtimeView).activePage || settings.deck.activePage || settings.deck.pages[0].id;
    this.skinId = skinId;
    this.viewId = storedView(skin);
    this.selectionTarget = defaultTarget(skin, this.pageId, this.viewId);
    this.previousSkinId = skinId;
    this.previousViewId = this.viewId;
    this.previousPageId = this.pageId;

    $effect(() => this.reconcilePages());
    $effect(() => this.reconcilePage());
    $effect(() => this.followDashboardSkin());
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
      this.skin.id === slot.skinId &&
      this.visibleSlots.includes(slot.slotId)
    );
  }

  /** A check that stays true while the editor shows `slot` the way it does now. */
  watch(slot: LayoutTarget) {
    const skinId = this.skin.id;
    const viewId = this.viewId;
    const generation = this.pageGeneration;
    return () =>
      this.page.id === slot.pageId &&
      this.skin.id === skinId &&
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
    this.selectionTarget = defaultTarget(this.skin, this.page.id, this.viewId);
    this.host.leave();
  }

  /** The dashboard switched skins: preview the new one. */
  private followDashboardSkin() {
    const skinId = settings.skin;
    if (skinId === this.previousActiveSkinId) {
      return;
    }
    this.previousActiveSkinId = skinId;
    const skin = skins.get(skinId);
    if (!skin) {
      return;
    }
    this.skinId = skin.id;
    this.viewId = storedView(skin);
    this.selectionTarget = defaultTarget(skin, this.page.id, this.viewId);
    this.clearTransient();
  }

  /** The previewed skin or view changed: remember the view and keep the selection inside it. */
  private reconcileView() {
    const skinId = this.skinId;
    const viewId = this.viewId;
    if (skinId === this.previousSkinId && viewId === this.previousViewId) {
      return;
    }
    this.previousSkinId = skinId;
    this.previousViewId = viewId;
    const skin = skins.get(skinId);
    const view = skin?.views.find((entry) => entry.id === viewId);
    if (!skin || !view) {
      return;
    }
    layoutPreview.views[skinId] = viewId;
    const target = this.selectionTarget;
    if (!view.slots.includes(target.slotId) || target.skinId !== skinId) {
      this.selectionTarget = defaultTarget(skin, this.page.id, viewId);
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
    const { skinId, pageId, slotId } = this.target;
    if (
      !layoutFor(settings, skinId, pageId, slotId)?.items.some((item) => item.id === selectedId)
    ) {
      this.selection = null;
    }
  }

  private clearTransient() {
    this.selection = null;
    this.host.leave();
  }
}

import { tick } from 'svelte';
import { toast } from 'svelte-sonner';
import { appletById } from '../../applets/deck';
import { settings } from '../../settings/state.svelte';
import { layoutFor, type LayoutTarget } from '../applet-layouts';
import { moveToSlot, NO_ROOM } from '../slot-edits';
import { moveOptions as buildMoveOptions, type MoveMode } from '../move-options';
import type { LayoutEditorState } from './editor-state.svelte';

type MoveRequest = {
  mode: MoveMode;
  sourceTarget: LayoutTarget;
  itemId: string;
  destinationKey: string;
};

export class WidgetMove {
  request = $state<MoveRequest | null>(null);
  open = $state(false);
  readonly options = $derived(
    this.request
      ? this.optionsFor(this.request.mode, this.request.sourceTarget, this.request.itemId)
      : [],
  );
  readonly destination = $derived(
    this.options.find((option) => option.value === this.request?.destinationKey && !option.disabled)
      ?.target,
  );

  constructor(private readonly editor: LayoutEditorState) {}

  pagesChanged(ids: string[]) {
    const request = this.request;
    if (
      request &&
      (!ids.includes(request.sourceTarget.pageId) ||
        !this.options.some((option) => option.value === request.destinationKey))
    ) {
      this.closeMoveDialog();
    }
  }

  choose(value: string) {
    if (this.request) {
      this.request.destinationKey = value;
    }
  }

  private optionsFor(mode: MoveMode, sourceTarget: LayoutTarget, itemId: string) {
    const applet = appletById(sourceTarget.appletId);
    return buildMoveOptions(settings, applet, mode, sourceTarget, itemId);
  }

  openMoveDialog(mode: MoveMode, sourceTarget: LayoutTarget, itemId: string) {
    const { appletId, pageId, slotId } = sourceTarget;
    const source = layoutFor(settings, appletId, pageId, slotId);
    const firstAvailable = this.optionsFor(mode, sourceTarget, itemId).find(
      (option) => !option.disabled,
    );
    if (!source?.items.some((item) => item.id === itemId) || !firstAvailable) {
      toast.error(NO_ROOM);
      return;
    }
    this.request = {
      mode,
      sourceTarget: { ...sourceTarget },
      itemId,
      destinationKey: firstAvailable.value,
    };
    this.open = true;
  }

  async finishMove() {
    const request = this.request;
    const destination = this.destination;
    if (!request || !destination || !this.moveSourceStillShown(request)) {
      this.closeMoveDialog();
      return;
    }
    const moved = moveToSlot(request.itemId, destination);
    if (!moved) {
      toast.error(NO_ROOM);
      return;
    }
    this.editor.pageId = destination.pageId;
    this.editor.selectionTarget = destination;
    this.closeMoveDialog();
    await tick();
    this.editor.select({ item: moved.id }, destination);
  }

  private moveSourceStillShown(request: MoveRequest) {
    const { appletId, pageId, slotId } = request.sourceTarget;
    const source = layoutFor(settings, appletId, pageId, slotId);
    return (
      this.editor.pageId === pageId &&
      this.editor.applet.id === appletId &&
      !!source?.items.some((item) => item.id === request.itemId) &&
      this.editor.slotIds.includes(slotId)
    );
  }

  closeMoveDialog() {
    this.open = false;
    this.request = null;
  }
}

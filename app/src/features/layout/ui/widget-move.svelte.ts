import { tick } from 'svelte';
import { toast } from 'svelte-sonner';
import { skins } from '../../plugins/registry';
import { settings } from '../../settings/state.svelte';
import { layoutFor, type LayoutTarget } from '../skin-layouts';
import { moveToSlot } from '../slot-edits';
import { moveOptions as buildMoveOptions, type MoveMode } from '../move-options';
import type { LayoutEditorState } from './editor-state.svelte';

type MoveRequest = {
  mode: MoveMode;
  sourceTarget: LayoutTarget;
  itemId: string;
  destinationKey: string;
};

const NO_ROOM = 'No free space for this widget';

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

  destroy() {
    this.closeMoveDialog();
  }

  optionsFor(mode: MoveMode, sourceTarget: LayoutTarget, itemId: string) {
    const skin = skins.get(sourceTarget.skinId);
    const slots = skin?.views.find((view) => view.id === this.editor.viewId)?.slots ?? [];
    return buildMoveOptions(settings, skin, slots, mode, sourceTarget, itemId);
  }

  openMoveDialog(mode: MoveMode, sourceTarget: LayoutTarget, itemId: string) {
    const { skinId, pageId, slotId } = sourceTarget;
    const source = layoutFor(settings, skinId, pageId, slotId);
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

  moveSourceStillShown(request: MoveRequest) {
    const { skinId, pageId, slotId } = request.sourceTarget;
    const source = layoutFor(settings, skinId, pageId, slotId);
    return (
      this.editor.pageId === pageId &&
      this.editor.skin.id === skinId &&
      !!source?.items.some((item) => item.id === request.itemId) &&
      this.editor.visibleSlots.includes(slotId)
    );
  }

  closeMoveDialog() {
    this.open = false;
    this.request = null;
  }
}

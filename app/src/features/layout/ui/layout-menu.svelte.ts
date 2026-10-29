import { toast } from 'svelte-sonner';
import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
import type { RuntimeCommands } from '../../../app/runtime/commands';
import type { Trigger } from '../../automation/scenario';
import { settings } from '../../settings/state.svelte';
import type { Selection } from '../grid';
import type { MoveMode } from '../move-options';
import { layoutFor, type LayoutTarget } from '../applet-layouts';
import { pasteInSlot, removeWithDust } from '../slot-edits';
import { clipboard } from '../widget-clipboard.svelte';
import { planInsertion, type WidgetCopy } from '../widget-insert';
import type { MenuAction } from '../../../panel/ui/ContextMenu.svelte';
import type { LayoutEditorState } from './editor-state.svelte';
import { layoutMenuActions } from './layout-menu';

type Target = NonNullable<Selection>;
type MenuState = {
  pageId: string;
  layoutTarget: LayoutTarget;
  target: Target;
  x: number;
  y: number;
  actions: MenuAction[];
  generation: number;
};

const NO_ROOM = 'No free space for this widget';

export class LayoutMenu {
  context = $state<MenuState | null>(null);
  open = $state(false);
  private generation = 0;

  constructor(
    private readonly editor: LayoutEditorState,
    private readonly runtime: RuntimeCommands,
    private readonly host: {
      openScenario(controlId: string, itemId: string, trigger: Trigger): void;
      openMove(mode: MoveMode, target: LayoutTarget, itemId: string): void;
    },
  ) {
    $effect(() => {
      const payload = this.context;
      if (!this.open || !payload) {
        return;
      }
      if (!(
        sameTarget(this.editor.selection, payload.target) &&
        payload.pageId === this.editor.page.id &&
        payload.layoutTarget.appletId === this.editor.applet.id &&
        this.targetExists(payload)
      )) {
        this.closeMenu(payload.generation);
      }
    });
  }

  destroy() {
    this.closeCurrentMenu();
  }

  private pasteClipboard(target: Target, pageId: string, slot: LayoutTarget) {
    const latest = clipboard.value;
    if (latest) {
      void this.paste(structuredClone($state.snapshot(latest)), target, pageId, slot);
    }
  }

  targetExists(payload: MenuState) {
    const { appletId, pageId, slotId } = payload.layoutTarget;
    const slot = layoutFor(settings, appletId, pageId, slotId);
    if (!settings.deck.pages.some((candidate) => candidate.id === payload.pageId) || !slot) {
      return false;
    }
    const target = payload.target;
    if ('item' in target) {
      return slot.items.some((item) => item.id === target.item);
    }
    const geometry = slot.geometry;
    return (
      !!geometry &&
      target.cell.x >= 0 &&
      target.cell.y >= 0 &&
      target.cell.x < geometry.cols &&
      target.cell.y < geometry.rows
    );
  }

  openMenu(target: Target, x: number, y: number, layoutTarget: LayoutTarget = this.editor.target) {
    const snapshot: Target =
      'item' in target ? { item: target.item } : { cell: { ...target.cell } };
    this.context = {
      pageId: this.editor.page.id,
      layoutTarget,
      target: snapshot,
      x,
      y,
      actions: layoutMenuActions(snapshot, this.editor.page.id, layoutTarget, {
        editor: this.editor,
        paste: (target, pageId, slot) => this.pasteClipboard(target, pageId, slot),
        placed: (id, slot) => this.placed(id, slot),
        remove: (id, target) => this.removeItemFromPage(id, target),
        openScenario: this.host.openScenario,
        openMove: this.host.openMove,
        simulate: (controlId, itemId, trigger) => this.simulate(controlId, itemId, trigger),
        simulateEvent: (eventId, parameter) => this.simulateEvent(eventId, parameter),
        stop: (controlId) => {
          void this.runtime.stopRuntimeControl(controlId);
        },
      }).map((action) => ({ ...action })),
      generation: ++this.generation,
    };
    this.open = true;
  }

  closeMenu(generation: number) {
    if (this.context?.generation === generation) {
      this.open = false;
    }
  }

  closeCurrentMenu() {
    if (this.context) {
      this.closeMenu(this.context.generation);
    }
  }

  placed(id: string | undefined, slot: LayoutTarget) {
    if (!id) {
      toast.error(NO_ROOM);
      return;
    }
    this.editor.select({ item: id }, slot);
  }

  insert(
    copy: WidgetCopy,
    target: Target,
    pageId: string,
    slot: LayoutTarget,
    label = 'Paste widget',
  ) {
    this.placed(
      this.editor.shows(pageId, slot) ? pasteInSlot(slot, copy, target, label) : undefined,
      slot,
    );
  }

  async paste(copy: WidgetCopy, target: Target, pageId: string, slot: LayoutTarget) {
    if (!this.editor.shows(pageId, slot) || !planInsertion(settings, copy, target, slot)) {
      toast.error(NO_ROOM);
      return;
    }
    if (!('item' in target)) {
      this.insert(copy, target, pageId, slot);
      return;
    }
    const id = target.item;
    if (!(await confirm({ title: 'Replace widget?', action: 'Replace', destructive: true }))) {
      return;
    }
    const current = layoutFor(settings, slot.appletId, slot.pageId, slot.slotId);
    if (this.editor.page.id !== pageId || !current?.items.some((item) => item.id === id)) {
      return;
    }
    this.insert(copy, target, pageId, slot, 'Paste over widget');
  }

  async simulate(controlId: string, itemId: string, trigger: Trigger) {
    const result = await this.runtime.dispatchRuntimeTrigger(controlId, itemId, trigger);
    if (result.status === 'rejected') {
      toast.error('Runtime owner is unavailable');
    }
  }

  async simulateEvent(eventId: string, parameter?: string) {
    if (!(await this.runtime.simulateRuntimeEvent(eventId, parameter))) {
      toast.error('Runtime owner is unavailable');
    }
  }

  removeItemFromPage(id: string, target: LayoutTarget) {
    const stillShown = this.editor.watch(target);
    void removeWithDust(target, id, stillShown).then((removed) => {
      if (
        removed &&
        this.editor.selection &&
        'item' in this.editor.selection &&
        this.editor.selection.item === id
      ) {
        this.editor.selection = null;
      }
    });
  }
}

function sameTarget(current: Selection, target: Target) {
  if (!current) {
    return false;
  }
  if ('item' in target) {
    return 'item' in current && current.item === target.item;
  }
  return 'cell' in current && current.cell.x === target.cell.x && current.cell.y === target.cell.y;
}

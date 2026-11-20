import { get } from 'svelte/store';
import { runtimeView } from '../../../app/runtime/state';
import { isEmptyList, TRIGGER_LABELS, TRIGGERS, type Trigger } from '../../automation/scenario';
import { registeredEvents } from '../../plugins/registry';
import { controlById, settings } from '../../settings/state.svelte';
import type { Selection } from '../grid';
import { moveOptions, type MoveMode } from '../move-options';
import { appletById } from '../../applets/deck';
import { layoutFor, type LayoutTarget } from '../applet-layouts';
import { duplicateInSlot, unlinkPlacement } from '../slot-edits';
import { controlUseCount } from '../placements';
import { clipboard } from '../widget-clipboard.svelte';
import { clonePlain } from '../../automation/plain-data';
import type { MenuAction } from '../../../panel/ui/ContextMenu.svelte';
import type { LayoutEditorState } from './editor-state.svelte';

type Target = NonNullable<Selection>;
type LayoutMenuHost = {
  editor: LayoutEditorState;
  paste(target: Target, pageId: string, slot: LayoutTarget, mode?: 'copy' | 'link'): void;
  placed(id: string | undefined, slot: LayoutTarget): void;
  remove(id: string, target: LayoutTarget): void;
  openScenario(controlId: string, itemId: string, trigger: Trigger): void;
  openMove(mode: MoveMode, target: LayoutTarget, itemId: string): void;
  simulate(controlId: string, itemId: string, trigger: Trigger): Promise<void>;
  simulateEvent(eventId: string, parameter?: string): Promise<void>;
  stop(controlId: string): void;
};

export function layoutMenuActions(
  target: Target,
  pageId: string,
  slot: LayoutTarget,
  host: LayoutMenuHost,
): MenuAction[] {
  const source = layoutFor(settings, slot.appletId, slot.pageId, slot.slotId);
  if (!source || pageId !== slot.pageId) {
    return [];
  }
  const item = 'item' in target ? source.items.find((i) => i.id === target.item) : undefined;
  const control = item ? controlById(item.control) : undefined;
  const hasPasteTarget = 'cell' in target ? !!target.cell : !!item;
  const pasteAction: MenuAction = {
    label: 'Paste',
    disabled: !clipboard.value || !hasPasteTarget,
    run: () => host.paste(target, pageId, slot, 'copy'),
  };
  const canPasteLinked =
    !!clipboard.value &&
    hasPasteTarget &&
    settings.controls.some((entry) => entry.id === clipboard.value?.control.id);
  const pasteActions: MenuAction[] = canPasteLinked
    ? [pasteAction, { label: 'Paste linked', run: () => host.paste(target, pageId, slot, 'link') }]
    : [pasteAction];
  const edit: MenuAction = { label: 'Edit', run: () => host.editor.select(target, slot) };
  if (!item || !control) {
    return 'cell' in target ? [edit, ...pasteActions] : [];
  }
  const applet = appletById(slot.appletId);

  const eventTitles = new Map(registeredEvents().map((event) => [event.id, event.title]));
  const configured = TRIGGERS.filter(
    (trigger) => !isEmptyList(control.scenario?.triggers[trigger]),
  );
  const running = (get(runtimeView).busy[control.id] ?? 0) > 0;
  const actions: MenuAction[] = [
    edit,
    { label: 'Edit scenario', run: () => host.openScenario(control.id, item.id, 'press') },
    ...configured.map((trigger) => ({
      label: `Simulate ${TRIGGER_LABELS[trigger]}`,
      run: () => void host.simulate(control.id, item.id, trigger),
    })),
    ...(control.scenario?.events ?? []).map((event) => ({
      label: `Simulate ${eventTitles.get(event.eventId) ?? event.eventId}`,
      run: () => void host.simulateEvent(event.eventId, event.parameter),
    })),
  ];
  if (running) {
    actions.push({ label: 'Stop', run: () => void host.stop(control.id) });
  }
  actions.push(
    {
      label: 'Copy',
      run: () => {
        clipboard.value = { control: clonePlain(control), w: item.w, h: item.h };
        void navigator.clipboard?.writeText(JSON.stringify(clipboard.value)).catch(() => {});
      },
    },
    ...pasteActions,
    ...(controlUseCount(settings, control.id) > 1
      ? [
          {
            label: 'Make unique',
            run: () => {
              if (host.editor.shows(pageId, slot)) {
                unlinkPlacement(slot, item.id);
              }
            },
          },
        ]
      : []),
    {
      label: 'Move to page…',
      disabled: !moveOptions(settings, applet, 'page', slot, item.id).some(
        (option) => !option.disabled,
      ),
      run: () => host.openMove('page', slot, item.id),
    },
    {
      label: 'Move to slot…',
      disabled: !moveOptions(settings, applet, 'slot', slot, item.id).some(
        (option) => !option.disabled,
      ),
      run: () => host.openMove('slot', slot, item.id),
    },
    {
      label: 'Duplicate',
      run: () =>
        host.placed(
          host.editor.shows(pageId, slot) ? duplicateInSlot(slot, item.id) : undefined,
          slot,
        ),
    },
    { label: 'Delete', danger: true, run: () => host.remove(item.id, slot) },
  );
  return actions;
}

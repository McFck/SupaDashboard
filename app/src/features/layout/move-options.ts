// Destinations offered by "Move to page…" and "Move to slot…" for one placement.
import type { Settings } from '../settings/schema';
import type { AppletDef } from '../applets/contracts';
import { movePlacementToSlot, type LayoutTarget } from './applet-layouts';

export type MoveMode = 'page' | 'slot';
export type MoveOption = {
  value: string;
  label: string;
  detail?: string;
  disabled: boolean;
  target: LayoutTarget;
};

/**
 * Page mode keeps the slot and lists other pages; slot mode lists every slot of the applet on every page.
 * Destinations without room for the placement are listed but disabled.
 */
export function moveOptions(
  source: Settings,
  applet: AppletDef | undefined,
  mode: MoveMode,
  from: LayoutTarget,
  itemId: string,
): MoveOption[] {
  const slotIds = applet?.slots.map((slot) => slot.id) ?? [];
  if (!slotIds.includes(from.slotId)) {
    return [];
  }
  const slots = mode === 'page' ? [from.slotId] : slotIds;
  return source.deck.pages.flatMap((page) =>
    slots.flatMap((slotId) => {
      const samePage = page.id === from.pageId;
      if ((samePage && slotId === from.slotId) || (mode === 'page' && samePage)) {
        return [];
      }
      const target = { appletId: from.appletId, pageId: page.id, slotId };
      return [
        {
          value: JSON.stringify([page.id, slotId]),
          label: page.name,
          detail: mode === 'page' ? undefined : slotId,
          disabled: !movePlacementToSlot(source, itemId, target),
          target,
        },
      ];
    }),
  );
}

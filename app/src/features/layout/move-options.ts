// Destinations offered by "Move to page…" and "Move to slot…" for one placement.
import type { Settings } from '../settings/schema';
import type { AppletDef } from '../applets/contracts';
import { appletFor } from '../applets/deck';
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
 * Page mode keeps the applet and slot; slot mode lists each page's displayed applet slots.
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
  return source.deck.pages.flatMap((page) => {
    const destinationApplet = appletFor(page);
    if (mode === 'page' && destinationApplet.id !== from.appletId) {
      return [];
    }
    const slots = mode === 'page' ? [from.slotId] : destinationApplet.slots.map((slot) => slot.id);
    return slots.flatMap((slotId) => {
      const samePage = page.id === from.pageId;
      if ((samePage && slotId === from.slotId) || (mode === 'page' && samePage)) {
        return [];
      }
      const target = { appletId: destinationApplet.id, pageId: page.id, slotId };
      return [
        {
          value: JSON.stringify([page.id, slotId]),
          label: page.name,
          detail: mode === 'page' ? undefined : slotId,
          disabled: !movePlacementToSlot(source, itemId, target),
          target,
        },
      ];
    });
  });
}

// Destinations offered by "Move to page…" and "Move to slot…" for one placement.
import type { Settings } from '../settings/schema';
import type { SkinDef } from '../skins/contracts';
import { movePlacementToSlot, type LayoutTarget } from './skin-layouts';

export type MoveMode = 'page' | 'slot';
export type MoveOption = {
  value: string;
  label: string;
  detail?: string;
  disabled: boolean;
  target: LayoutTarget;
};

/**
 * Page mode keeps the slot and lists other pages; slot mode lists every slot of the visible view on every page.
 * Destinations without room for the placement are listed but disabled.
 */
export function moveOptions(
  source: Settings,
  skin: SkinDef | undefined,
  visibleSlots: readonly string[],
  mode: MoveMode,
  from: LayoutTarget,
  itemId: string,
): MoveOption[] {
  if (!skin || !visibleSlots.includes(from.slotId)) {
    return [];
  }
  const slots = mode === 'page' ? [from.slotId] : visibleSlots;
  return source.deck.pages.flatMap((page) =>
    slots.flatMap((slotId) => {
      const samePage = page.id === from.pageId;
      if ((samePage && slotId === from.slotId) || (mode === 'page' && samePage)) {
        return [];
      }
      const target = { skinId: from.skinId, pageId: page.id, slotId };
      return [
        {
          value: `${page.id}::${slotId}`,
          label: page.name,
          detail: mode === 'page' ? undefined : slotId,
          disabled: !movePlacementToSlot(source, itemId, target),
          target,
        },
      ];
    }),
  );
}

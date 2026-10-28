import type { ControlConfig } from '../controls/model';
import { normalizeControl } from '../automation/normalize-control';
import type { Settings } from './schema';
import { DEFAULTS } from './defaults';
import { isRecord, object } from './validation';
import { upgrade } from './upgrade';
import { normalizeLayout } from './normalize-layout';

/** Bring any saved settings up to the current version without losing the user's controls. */
export function migrate(input: unknown): Settings {
  const out = structuredClone(DEFAULTS);
  if (input === undefined || input === null) {
    return out;
  }
  if (!isRecord(input)) {
    throw new Error('Settings must be an object');
  }
  const { saved, rawControls } = upgrade(input);
  // Preserve explicit colours and empty labels while canonicalizing every control once.
  for (const control of rawControls) {
    for (const variant of control.variants) {
      variant.color ??= control.color ?? '#8ea8f0';
    }
  }
  const controls = rawControls.map((control) => normalizeControl(control));
  delete saved.slots; // the strip editor was removed; skins reuse the deck's controls

  const { deck, skinLayouts, pageIds, itemIds } = normalizeLayout(saved);
  const pages = deck.pages;
  const skinSettings =
    saved.skinSettings &&
    typeof saved.skinSettings === 'object' &&
    !Array.isArray(saved.skinSettings)
      ? Object.fromEntries(
          Object.entries(saved.skinSettings)
            .filter(
              (entry): entry is [string, Record<string, unknown>] =>
                !!entry[0] && isRecord(entry[1]),
            )
            .map(([id, value]) => [id, structuredClone(value)]),
        )
      : {};

  // Placements used to share one control (and its state); give every extra placement its own copy.
  const variants: Settings['variants'] = {};
  for (const [id, index] of Object.entries(object(saved.variants))) {
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
      throw new Error('Saved control state must be a nonnegative integer');
    }
    variants[id] = index;
  }
  const seen = new Set<string>(),
    globalIds = new Set([...pageIds, ...itemIds, ...controls.map((c: ControlConfig) => c.id)]);
  const placementLists = [
    ...pages.map((page) => page.items),
    ...Object.values(skinLayouts).flatMap((skin) =>
      Object.values(skin).flatMap((page) => Object.values(page)),
    ),
  ];
  for (const items of placementLists)
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!seen.has(item.control)) {
        seen.add(item.control);
        continue;
      }
      const source = controls.find((c: ControlConfig) => c.id === item.control);
      if (!source) continue;
      let id = `${source.id}-2`,
        suffix = 3;
      while (globalIds.has(id)) id = `${source.id}-${suffix++}`;
      globalIds.add(id);
      controls.push({ ...structuredClone(source), id });
      if (Object.hasOwn(variants, source.id)) {
        variants[id] = variants[source.id];
      }
      items[index] = { ...item, control: id };
    }

  const display = object(saved.display);
  const background = object(display.background);
  delete saved.pageRotation;
  return {
    ...out,
    ...saved,
    version: 5,
    skin: typeof saved.skin === 'string' ? saved.skin : out.skin,
    controls,
    display: {
      ...out.display,
      ...display,
      monitor: typeof display.monitor === 'string' ? display.monitor : null,
      fullscreen: typeof display.fullscreen === 'boolean' ? display.fullscreen : false,
      alwaysOnTop: typeof display.alwaysOnTop === 'boolean' ? display.alwaysOnTop : false,
      background: {
        ...out.display.background,
        ...background,
        color:
          typeof background.color === 'string' ? background.color : out.display.background.color,
        opacity:
          typeof background.opacity === 'number' && Number.isFinite(background.opacity)
            ? background.opacity
            : out.display.background.opacity,
        radius:
          typeof background.radius === 'number' && Number.isFinite(background.radius)
            ? background.radius
            : out.display.background.radius,
      },
    },
    deck,
    skinSettings,
    skinLayouts,
    variants,
  };
}

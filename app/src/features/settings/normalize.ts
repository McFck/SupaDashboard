import type { ControlConfig } from '../controls/model';
import { normalizeControl } from '../automation/normalize-control';
import type { Settings } from './schema';
import { DEFAULTS, ICON_SCALE, LABEL_SCALE } from './defaults';
import { isRecord } from '../automation/plain-data';
import { object, upgrade } from './upgrade';
import { normalizeAppletSettings, normalizeLayout } from './normalize-layout';
import { readNowPlayingOptions } from '../media/now-playing';

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
  for (const control of controls) {
    if (control.type !== 'nowPlaying') {
      continue;
    }
    // A damaged filter must fail the load; falling back to All would silently show another source.
    const sources = readNowPlayingOptions(control.options);
    if (!sources) {
      throw new Error('Now playing sources are malformed');
    }
    control.options = { ...control.options, sources };
  }
  delete saved.slots; // the strip editor was removed; applets reuse the deck's controls

  const { deck, appletLayouts, pageIds, itemIds } = normalizeLayout(saved);
  const pages = deck.pages;
  const appletSettings = normalizeAppletSettings(saved.appletSettings);

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
    ...Object.values(appletLayouts).flatMap((applet) =>
      Object.values(applet).flatMap((page) => Object.values(page)),
    ),
  ];
  for (const items of placementLists) {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!seen.has(item.control)) {
        seen.add(item.control);
        continue;
      }
      const source = controls.find((c: ControlConfig) => c.id === item.control);
      if (!source) {
        continue;
      }
      let id = `${source.id}-2`,
        suffix = 3;
      while (globalIds.has(id)) {
        id = `${source.id}-${suffix++}`;
      }
      globalIds.add(id);
      controls.push({ ...structuredClone(source), id });
      if (Object.hasOwn(variants, source.id)) {
        variants[id] = variants[source.id];
      }
      items[index] = { ...item, control: id };
    }
  }

  const apps = saved.apps ?? [];
  if (!Array.isArray(apps) || !apps.every((app) => typeof app === 'string')) {
    throw new Error('Saved apps must be a list of text');
  }
  // `iconSize: 'large'` was the short-lived first form of `iconScale`; it maps to 1.5 and is dropped.
  const { iconSize, ...display } = object(saved.display);
  const background = object(display.background);
  const pick = <T>(value: unknown, guard: (v: unknown) => boolean, fallback: T) =>
    guard(value) ? (value as T) : fallback;
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  delete saved.pageRotation;
  return {
    ...out,
    ...saved,
    version: 18,
    controls,
    display: {
      ...out.display,
      ...display,
      monitor: pick(display.monitor, (v) => typeof v === 'string', null),
      monitorLabel: pick(display.monitorLabel, (v) => typeof v === 'string', null),
      fullscreen: pick(display.fullscreen, (v) => typeof v === 'boolean', false),
      alwaysOnTop: pick(display.alwaysOnTop, (v) => typeof v === 'boolean', false),
      iconScale: pick(
        display.iconScale,
        (v) => typeof v === 'number' && v >= ICON_SCALE.min && v <= ICON_SCALE.max,
        iconSize === 'large' ? 1.5 : 1,
      ),
      labelScale: pick(
        display.labelScale,
        (v) => typeof v === 'number' && v >= LABEL_SCALE.min && v <= LABEL_SCALE.max,
        1,
      ),
      background: {
        ...out.display.background,
        ...background,
        mode: background.mode === 'wallpaper' ? 'wallpaper' : 'color',
        color: pick(background.color, (v) => typeof v === 'string', out.display.background.color),
        opacity: pick(background.opacity, finite, out.display.background.opacity),
        radius: pick(background.radius, finite, out.display.background.radius),
      },
    },
    deck,
    appletSettings,
    appletLayouts,
    variants,
    apps: [...new Set(apps)],
  };
}
